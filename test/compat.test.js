// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

/** v0.1 → v0.2 backward compatibility: the six original tools, their schemas, the receipts file format and the CLI stay as they were. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/config.js';
import { ReceiptStore } from '../src/receipts.js';
import { tools } from '../src/tools.js';
import { setup } from './helpers.js';

const V01_TOOLS = {
  inbox: ['state'], read: ['number'], comment: ['number', 'body'], label: ['number', 'add', 'remove'], propose: ['title', 'body', 'labels'], review: ['number', 'event', 'body'],
};

test('compat: original six tools come first with unchanged names and input properties', (t) => {
  const { mailbox } = setup(t);
  const list = tools(mailbox);
  assert.deepEqual(list.slice(0, 6).map((x) => x.name), Object.keys(V01_TOOLS));
  for (const tool of list.slice(0, 6)) {
    assert.deepEqual(Object.keys(tool.inputSchema.properties), V01_TOOLS[tool.name], tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('compat: a v0.1 config file and receipts file still load; new keys are optional', (t) => {
  const { dir } = setup(t);
  const receipts = path.join(dir, 'old.json');
  fs.writeFileSync(receipts, JSON.stringify({ version: 1, receipts: { abc: { kind: 'comment', agent: 'a', state: 'CONFIRMED', attemptedAt: '2026-01-01T00:00:00.000Z', result: { comment_id: 1 } } } }));
  const config = parseConfig({ repository: 'example-org/example-repo', agent: 'a', receiptsFile: receipts, allowedLabels: ['needs-review'], limits: { writesPerDay: 3 } });
  const store = new ReceiptStore(config.receiptsFile);
  assert.equal(store.get('abc').state, 'CONFIRMED');
  assert.equal(store.list().length, 1);
  store.markFailed('abc', 'test');
  assert.equal(JSON.parse(fs.readFileSync(receipts, 'utf8')).version, 1);
});

test('compat: CLI help still lists every v0.1 command', () => {
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const out = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).stdout;
  for (const cmd of ['serve', 'doctor', 'inbox', 'read <number>', 'comment <number>', 'label <number>', 'propose --title', 'review <number>', 'receipts list', 'receipts resolve']) assert.ok(out.includes(cmd), cmd);
});
