// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseConfig } from '../src/config.js';
import { EvidenceLog, canonical, loadPublicKey, verify } from '../src/evidence.js';
import { ReceiptStore } from '../src/receipts.js';
import { setup } from './helpers.js';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-postbox-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('evidence: canonical JSON matches the shared spec (sorted keys, compact, unicode kept)', () => {
  assert.equal(canonical({ b: 1, a: 'ä', c: [1, { z: true, y: null }] }), '{"a":"ä","b":1,"c":[1,{"y":null,"z":true}]}');
  assert.equal(canonical({ ts: 1.5 }), '{"ts":1.5}');
});

test('evidence: chain + signatures verify; modified, removed, reordered, forged, truncated entries are detected', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'e.jsonl');
  const key = path.join(dir, 'k.pem');
  let now = 1_800_000_000;
  const log = new EvidenceLog(file, key, { now: () => (now += 1) });
  for (let i = 1; i <= 4; i++) log.append({ event: i % 2 ? 'ATTEMPTED' : 'CONFIRMED', call_id: `k${Math.ceil(i / 2)}`, tool: 'comment', by: 'agent-a', readback: i % 2 ? '' : 'ok' });
  const pub = loadPublicKey(`${key}.pub`);
  assert.deepEqual(verify(file, pub), { ok: true, problems: [], warnings: [], entries: 4 });
  // ts is integer milliseconds – an integral second (1800000001.0) must not become "1800000001.0" vs "1800000001" across languages
  for (const l of fs.readFileSync(file, 'utf8').trim().split('\n')) assert.ok(Number.isInteger(JSON.parse(l).ts) && /"ts":\d+[,}]/.test(l));
  // head sidecar is signed: rewriting it to the truncated tail is caught, deleting it is a warning
  const headFile = `${file}.head`;
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(headFile, 'utf8'))).sort(), ['hash', 'seq', 'sig']);
  assert.equal(fs.statSync(key).mode & 0o777, 0o600);
  // restart continues the chain
  const again = new EvidenceLog(file, key, { now: () => (now += 1) });
  again.append({ event: 'FAILED', call_id: 'k3', tool: 'labels', by: 'agent-a' });
  assert.equal(verify(file, pub).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()).seq, 5);

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const write = (ls) => fs.writeFileSync(file, ls.join('\n') + '\n');
  const e = JSON.parse(lines[1]); e.decision = 'CONFIRMED'; write([lines[0], JSON.stringify(e), ...lines.slice(2)]);
  assert.match(verify(file, pub).problems[0].reason, /modified/);
  write([lines[0], ...lines.slice(2)]);
  assert.ok(verify(file, pub).problems.some((p) => /chain broken/.test(p.reason)));
  write([lines[0], lines[2], lines[1], ...lines.slice(3)]);
  assert.equal(verify(file, pub).ok, false);
  const forged = JSON.parse(lines[1]); forged.sig = '00'.repeat(64); write([lines[0], JSON.stringify(forged), ...lines.slice(2)]);
  assert.ok(verify(file, pub).problems.some((p) => /signature/.test(p.reason)));
  write(lines.slice(0, 3));
  assert.ok(verify(file, pub).problems.some((p) => /truncated/.test(p.reason)));
  const savedHead = fs.readFileSync(headFile, 'utf8');
  fs.writeFileSync(headFile, JSON.stringify({ seq: 3, hash: JSON.parse(lines[2]).hash, sig: '00'.repeat(64) }));
  assert.ok(verify(file, pub).problems.some((p) => /forged/.test(p.reason)));
  fs.rmSync(headFile);
  const r = verify(file, pub);
  assert.equal(r.ok, true); assert.match(r.warnings[0], /head sidecar missing/);
  fs.writeFileSync(headFile, savedHead);
  write(lines);
  assert.equal(verify(file, pub).ok, true);
  assert.equal(verify(path.join(dir, 'missing.jsonl'), pub).ok, false);
});

test('evidence: every receipt state change lands in the log; no bodies, titles or tokens', async (t) => {
  const base = setup(t);
  const dir = tmp(t);
  const evidence = new EvidenceLog(path.join(dir, 'e.jsonl'), path.join(dir, 'k.pem'));
  const receipts = new ReceiptStore(path.join(dir, 'r.json'), { evidence });
  const { Mailbox } = await import('../src/mailbox.js');
  const mailbox = new Mailbox({ config: base.config, github: base.github, receipts });
  base.gh.addIssue(1, { labels: [{ name: 'to:agent-a' }] });
  await mailbox.comment({ number: 1, body: 'SECRET-LOOKING-BODY-TEXT that must not be logged' });
  base.gh.dropNextWrite = true;
  await assert.rejects(mailbox.comment({ number: 1, body: 'second' }), (e) => e.code === 'UNKNOWN_OUTCOME');
  const entries = fs.readFileSync(path.join(dir, 'e.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(entries.map((e) => [e.event, e.tool, e.readback]), [['ATTEMPTED', 'comment', ''], ['CONFIRMED', 'comment', 'ok'], ['ATTEMPTED', 'comment', '']]);
  assert.ok(entries.every((e) => e.by === 'agent-a' && e.summary === 'comment #1'));
  assert.ok(!JSON.stringify(entries).includes('SECRET-LOOKING'));
  assert.equal(verify(path.join(dir, 'e.jsonl'), loadPublicKey(path.join(dir, 'k.pem.pub'))).ok, true);
  const resolved = receipts.resolve(entries[2].call_id, 'FAILED');
  assert.equal(resolved.state, 'FAILED');
  const last = JSON.parse(fs.readFileSync(path.join(dir, 'e.jsonl'), 'utf8').trim().split('\n').pop());
  assert.deepEqual([last.event, last.by], ['RESOLVED', 'human']);
});

test('evidence: config defaults next to the receipts file; "evidence": false disables it', () => {
  const c = parseConfig({ repository: 'o/r', agent: 'a', receiptsFile: '/tmp/x/o-r-a.json' });
  assert.equal(c.evidenceFile, '/tmp/x/o-r-a.evidence.jsonl');
  assert.equal(c.evidenceKeyFile, '/tmp/x/o-r-a.evidence-key.pem');
  assert.equal(c.handoffLabel, 'handoff');
  assert.equal(parseConfig({ repository: 'o/r', agent: 'a', evidence: false }).evidenceFile, null);
});
