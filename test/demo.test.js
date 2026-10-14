// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('offline demo runs end to end and shows every guarantee', () => {
  const out = execFileSync(process.execPath, ['examples/offline-demo/demo.mjs'], { encoding: 'utf8' });
  for (const expected of ['stopped: UNKNOWN_OUTCOME', 'reconciled', 'refused: SELF_REVIEW', 'refused: POLICY', 'refused: SECRET', '5/5 writes CONFIRMED', '0 duplicates']) {
    assert.ok(out.includes(expected), `missing in demo output: ${expected}`);
  }
});
