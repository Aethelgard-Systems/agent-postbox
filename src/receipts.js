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
 * atomically (tmp + rename) with mode 0600. One process per receipts file.
 */
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
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
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

  #update(key, patch) {
    const data = this.#load();
    const current = data.receipts[key] || {};
    data.receipts[key] = { ...current, ...patch, updatedAt: this.now().toISOString() };
    this.#save(data);
    return { key, ...data.receipts[key] };
  }

  attempt(key, meta) {
    return this.#update(key, { ...meta, state: STATE.ATTEMPTED, attemptedAt: this.now().toISOString() });
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
