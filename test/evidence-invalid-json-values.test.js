// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EvidenceLog, loadPublicKey, verify } from '../src/evidence.js';

test('evidence verifier reports non-object JSON and continues through later rows', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postbox-invalid-values-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'synthetic.jsonl');
  const key = path.join(dir, 'synthetic.pem');
  const log = new EvidenceLog(file, key);
  log.append({ event: 'ATTEMPTED' });
  log.append({ event: 'CONFIRMED' });
  const publicKey = loadPublicKey(`${key}.pub`);
  const [first, second] = fs.readFileSync(file, 'utf8').trim().split('\n');
  for (const value of ['null', '[]', '[{}]', '5', '"x"', 'true', 'false']) {
    // Keep valid signed rows before and after the bad row; corrupt the later
    // row too, proving verification continues after reporting the bad value.
    const tampered = JSON.parse(second);
    tampered.note = 'synthetic modification';
    fs.writeFileSync(file, `${first}\n${value}\n${JSON.stringify(tampered)}\n`);
    const result = verify(file, publicKey);
    assert.equal(result.ok, false, value);
    assert.equal(result.entries, 3, value);
    assert.ok(result.problems.some((p) => p.line === 2 && p.reason === 'not an object'), value);
    assert.ok(result.problems.some((p) => p.line === 3 && /hash mismatch/.test(p.reason)), value);
  }
  fs.writeFileSync(file, `${first}\n{broken\n${second}\n`);
  const invalid = verify(file, publicKey);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.problems.some((p) => p.line === 2 && p.reason === 'not JSON'));
  fs.writeFileSync(file, `${first}\n${second}\n`);
  assert.equal(verify(file, publicKey).ok, true);
});
