// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CODES, fail } from './errors.js';

/**
 * Durable write receipts.
 *
 * Every write is recorded as ATTEMPTED before the request leaves the machine
 * and as CONFIRMED only after a read-back from GitHub matches. A write whose
 * outcome is unknown (crash, timeout, 5xx) is never retried blindly.
 *
 * States: ATTEMPTED -> CONFIRMED | FAILED | UNVERIFIED
 *
 * The file is a local hint, not the source of truth: GitHub is. It is written
 * atomically (tmp + rename) with mode 0600 under an exclusive lock file, so
 * the MCP server and the CLI can share it. It stores keys, states, issue
 * numbers and HTTP status codes - never message bodies, titles or tokens.
 */
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const STATE = Object.freeze({
  ATTEMPTED: 'ATTEMPTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  UNVERIFIED: 'UNVERIFIED',
});

export function receiptKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export class ReceiptStore {
  constructor(file, { now = () => new Date() } = {}) {
    this.file = file;
    this.now = now;
  }

  #load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, receipts: {} };
      fail(CODES.RECEIPTS, `cannot read receipts file: ${e.code || e.message}`);
    }
    try {
      const data = JSON.parse(text);
      if (data?.version !== 1 || typeof data.receipts !== 'object') throw new Error('unexpected format');
      return data;
    } catch (e) {
      fail(CODES.RECEIPTS, `receipts file is corrupt (${e.message}); refusing to write until a human inspects ${this.file}`);
    }
  }

  #save(data) {
    try {
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      fail(CODES.RECEIPTS, `cannot persist receipt; nothing was written to GitHub (${e.code || e.message})`);
    }
  }

  get(key) {
    return this.#load().receipts[key] || null;
  }

  list() {
    return Object.entries(this.#load().receipts).map(([key, r]) => ({ key, ...r }));
  }

  #locked(fn) {
    const lock = `${this.file}.lock`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    } catch (e) {
      fail(CODES.RECEIPTS, `cannot create receipts directory; nothing was written to GitHub (${e.code || e.message})`);
    }
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.closeSync(fs.openSync(lock, 'wx', 0o600));
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') fail(CODES.RECEIPTS, `cannot lock receipts file; nothing was written to GitHub (${e.code || e.message})`);
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
        } catch { /* lock vanished meanwhile */ }
        if (Date.now() > deadline) fail(CODES.RECEIPTS, `receipts file is locked by another process (${lock})`);
        sleep(25);
      }
    }
    try {
      return fn();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }

  #update(key, patch, expectedState) {
    return this.#locked(() => {
      const data = this.#load();
      const current = data.receipts[key] || null;
      if (expectedState !== undefined && (current?.state ?? null) !== expectedState) {
        fail(CODES.UNKNOWN_OUTCOME, 'another process is writing the same item; check GitHub before retrying', { receipt: key });
      }
      data.receipts[key] = { ...(current || {}), ...patch, updatedAt: this.now().toISOString() };
      this.#save(data);
      return { key, ...data.receipts[key] };
    });
  }

  /** Compare-and-set: only succeeds if the receipt is still in the state the caller saw. */
  attempt(key, meta, expectedState) {
    return this.#update(key, { ...meta, state: STATE.ATTEMPTED, attemptedAt: this.now().toISOString() }, expectedState);
  }

  confirm(key, result) {
    return this.#update(key, { state: STATE.CONFIRMED, result });
  }

  markFailed(key, reason) {
    return this.#update(key, { state: STATE.FAILED, reason });
  }

  markUnverified(key, reason) {
    return this.#update(key, { state: STATE.UNVERIFIED, reason });
  }

  /** Human escape hatch after checking GitHub manually. */
  resolve(key, state) {
    if (!this.get(key)) fail(CODES.RECEIPTS, `no receipt ${key}`);
    if (![STATE.CONFIRMED, STATE.FAILED].includes(state)) fail(CODES.RECEIPTS, 'resolve state must be CONFIRMED or FAILED');
    return this.#update(key, { state, resolvedManually: true });
  }

  /** Writes counted against today's budget (UTC day), excluding definite failures. */
  countToday(kinds) {
    const day = this.now().toISOString().slice(0, 10);
    return this.list().filter(
      (r) => r.state !== STATE.FAILED && kinds.includes(r.kind) && String(r.attemptedAt || '').startsWith(day),
    ).length;
  }
}
