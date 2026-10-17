// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CODES, fail } from './errors.js';

/**
 * Evidence log: append-only JSONL, every entry hash-chained to its predecessor
 * and signed with Ed25519 (node:crypto, no dependencies).
 *
 * Format "evidence-v1" (docs/evidence-format.md). The same layout is used by
 * companion tools, so one verifier can check logs from different sources.
 *
 * Entry fields (keys sorted when hashed):
 *   seq, ts, event, call_id, tool, args_sha256, summary, decision, by,
 *   result_sha256, readback, note, prev   -> hash = sha256(canonical JSON)
 *   hash, sig (Ed25519 over the raw hash bytes, hex)
 * A sidecar "<log>.head" stores the last hash so truncation is detectable.
 */
export const GENESIS = '0'.repeat(64);
export const FIELDS = ['seq', 'ts', 'event', 'call_id', 'tool', 'args_sha256', 'summary', 'decision', 'by', 'result_sha256', 'readback', 'note', 'prev'];

/** Deterministic JSON: sorted keys, no whitespace, non-ASCII kept as-is (matches Python json.dumps(sort_keys, separators=(',', ':'), ensure_ascii=False)). */
export function canonical(obj) {
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  if (obj && typeof obj === 'object') return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  if (typeof obj === 'number' && Number.isInteger(obj)) return String(obj);
  return JSON.stringify(obj);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export function generateKey(file) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(`${file}.pub`, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  return publicKey;
}

export const loadPrivateKey = (file) => crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
export const loadPublicKey = (file) => crypto.createPublicKey(fs.readFileSync(file, 'utf8'));

export class EvidenceLog {
  /** `keyFile` is created on first use (0600) if missing. */
  constructor(file, keyFile, { now = () => Date.now() / 1000 } = {}) {
    this.file = file;
    this.keyFile = keyFile;
    this.now = now;
    this.seq = 0;
    this.prev = GENESIS;
    this.key = null;
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        this.seq = Number(last.seq) || 0;
        this.prev = last.hash;
      }
    }
  }

  #ensureKey() {
    if (this.key) return this.key;
    if (!fs.existsSync(this.keyFile)) generateKey(this.keyFile);
    this.key = loadPrivateKey(this.keyFile);
    return this.key;
  }

  append({ event, call_id = '', tool = '', args_sha256 = '', summary = '', decision = '', by = '', result_sha256 = '', readback = '', note = '' }) {
    const key = this.#ensureKey();
    const entry = {
      seq: this.seq + 1, ts: Math.round(this.now() * 1000), event, call_id, tool, args_sha256,
      summary: String(summary).slice(0, 500), decision, by, result_sha256, readback, note: String(note).slice(0, 500), prev: this.prev,
    };
    entry.hash = sha256(canonical(entry));
    entry.sig = crypto.sign(null, Buffer.from(entry.hash, 'hex'), key).toString('hex');
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.file, canonical(entry) + '\n', { mode: 0o600 });
    fs.writeFileSync(`${this.file}.head`, canonical(signedHead(entry.seq, entry.hash, key)));
    this.seq = entry.seq;
    this.prev = entry.hash;
    return entry;
  }
}

/** The head sidecar: `{seq, hash, sig}` with `sig` = Ed25519 over `head:<seq>:<hash>`, so a rewritten head is detectable. */
export const headMessage = (seq, hash) => Buffer.from(`head:${seq}:${hash}`, 'utf8');
export function signedHead(seq, hash, key) {
  return { seq, hash, sig: crypto.sign(null, headMessage(seq, hash), key).toString('hex') };
}

/** Returns { ok, problems: [{line, reason}], warnings: [string], entries }. Any edited, removed, reordered, inserted or
 *  truncated line is reported; a missing head sidecar is a warning (truncation at the very end cannot be ruled out then). */
export function verify(file, publicKey) {
  const problems = [];
  const warnings = [];
  if (!fs.existsSync(file)) return { ok: false, problems: [{ line: 0, reason: 'log file missing' }], entries: 0 };
  let prev = GENESIS;
  let seq = 0;
  let entries = 0;
  let lastHash = null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const ln = i + 1;
    entries++;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      problems.push({ line: ln, reason: 'not JSON' });
      return;
    }
    const keys = Object.keys(e).sort().join(',');
    if (keys !== [...FIELDS, 'hash', 'sig'].sort().join(',')) {
      problems.push({ line: ln, reason: 'unexpected fields' });
      prev = e.hash ?? prev;
      seq += 1; // keep counting so the next line is not blamed for a sequence gap as well
      return;
    }
    const body = Object.fromEntries(FIELDS.map((k) => [k, e[k]]));
    if (sha256(canonical(body)) !== e.hash) problems.push({ line: ln, reason: 'hash mismatch (entry modified)' });
    let sigOk = false;
    try {
      sigOk = crypto.verify(null, Buffer.from(e.hash, 'hex'), publicKey, Buffer.from(e.sig, 'hex'));
    } catch { /* malformed */ }
    if (!sigOk) problems.push({ line: ln, reason: 'signature invalid' });
    if (e.prev !== prev) problems.push({ line: ln, reason: 'chain broken (entry removed, reordered or inserted before this line)' });
    if (e.seq !== seq + 1) problems.push({ line: ln, reason: `sequence gap: expected ${seq + 1}, got ${e.seq}` });
    if (!Number.isInteger(e.ts)) problems.push({ line: ln, reason: 'ts must be integer milliseconds' });
    prev = e.hash;
    seq = Number.isInteger(e.seq) ? e.seq : seq + 1;
    lastHash = e.hash;
  });
  const head = `${file}.head`;
  if (!fs.existsSync(head)) {
    warnings.push('head sidecar missing: truncation at the end of the log cannot be ruled out');
  } else {
    let h = null;
    try { h = JSON.parse(fs.readFileSync(head, 'utf8')); } catch { /* legacy or damaged */ }
    let headSigOk = false;
    if (h && Number.isInteger(h.seq) && typeof h.hash === 'string' && typeof h.sig === 'string') {
      try { headSigOk = crypto.verify(null, headMessage(h.seq, h.hash), publicKey, Buffer.from(h.sig, 'hex')); } catch { /* malformed */ }
    }
    if (!headSigOk) problems.push({ line: entries, reason: 'head sidecar unsigned, damaged or forged' });
    else if (h.hash !== (lastHash || GENESIS) || h.seq !== seq) problems.push({ line: entries, reason: 'head mismatch (entries truncated at the end or head stale)' });
  }
  return { ok: problems.length === 0, problems, warnings, entries };
}

export function evidenceVerifyFromConfig(config) {
  if (!config.evidenceFile) fail(CODES.CONFIG, 'evidence log is disabled in this configuration');
  return verify(config.evidenceFile, loadPublicKey(`${config.evidenceKeyFile}.pub`));
}
