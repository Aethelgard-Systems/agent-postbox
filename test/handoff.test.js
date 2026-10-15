// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { GitHub } from '../src/github.js';
import { Mailbox } from '../src/mailbox.js';
import { ReceiptStore } from '../src/receipts.js';
import { parseConfig } from '../src/config.js';
import { setup, writes } from './helpers.js';
import path from 'node:path';

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function second(base, agent, login) {
  const config = parseConfig({ repository: 'example-org/example-repo', agent, receiptsFile: path.join(base.dir, `${agent}.json`) });
  const github = new GitHub({ owner: config.owner, repo: config.repo, token: 'synthetic-b', fetch: base.fake.fetchFor(login) });
  return new Mailbox({ config, github, receipts: new ReceiptStore(config.receiptsFile) });
}

test('handoff: create is receipted and read back; read returns the body hash; ack is bound to it', async (t) => {
  const base = setup(t, { agent: 'planner', login: 'planner-bot' });
  const builder = second(base, 'builder', 'builder-bot');
  const created = await base.mailbox.handoffCreate({ to: 'builder', title: 'Add a CONTRIBUTORS file', task: 'Create CONTRIBUTORS.md listing maintainers.', acceptance: ['file exists', 'CI green'] });
  assert.equal(created.status, 'CONFIRMED');
  assert.equal(created.to, 'builder');
  const issue = base.gh.issues.get(created.number);
  assert.deepEqual(issue.labels.map((l) => l.name), ['to:builder', 'handoff']);
  assert.match(issue.body, /^<!-- agent-postbox handoff v1 -->/);
  assert.match(issue.body, /## Acceptance\n- \[ \] file exists\n- \[ \] CI green/);
  assert.equal(created.body_sha256, sha(issue.body));
  // replay: same handoff again → receipt, not a second issue
  const again = await base.mailbox.handoffCreate({ to: 'builder', title: 'Add a CONTRIBUTORS file', task: 'Create CONTRIBUTORS.md listing maintainers.', acceptance: ['file exists', 'CI green'] });
  assert.equal(again.replay, true);
  assert.equal(base.gh.issues.size, 1);

  const read = await builder.handoffRead({ number: created.number });
  assert.equal(read.handoff, true);
  assert.deepEqual(read.to, ['builder']);
  assert.equal(read.body_sha256, created.body_sha256);
  assert.equal(read.acknowledged, false);

  const ack = await builder.handoffAck({ number: created.number, read_sha256: read.body_sha256, result: 'DONE', evidence: ['https://example.invalid/pr/2', 'tests: 12 passed'] });
  assert.equal(ack.status, 'CONFIRMED');
  assert.equal(ack.result, 'DONE');
  const after = await base.mailbox.handoffRead({ number: created.number });
  assert.equal(after.acknowledged, true);
  assert.equal(after.acks[0].result, 'DONE');
  assert.equal(after.acks[0].author, 'builder-bot');
  assert.equal(after.acks[0].read_sha256, read.body_sha256);
  assert.match(after.acks[0].body, /- https:\/\/example.invalid\/pr\/2/);
  // ack was read back (GET on the comment after POST)
  const calls = base.gh.calls.map((c) => `${c.method} ${c.path}`);
  const post = calls.findIndex((c) => c.startsWith(`POST /repos/example-org/example-repo/issues/${created.number}/comments`));
  assert.ok(calls.slice(post + 1).some((c) => c.startsWith('GET /repos/example-org/example-repo/issues/comments/')));
});

test('handoff: ack refused when the handoff changed, when DONE lacks evidence, when not addressed to the agent', async (t) => {
  const base = setup(t, { agent: 'planner', login: 'planner-bot' });
  const builder = second(base, 'builder', 'builder-bot');
  const other = second(base, 'reviewer', 'reviewer-bot');
  const created = await base.mailbox.handoffCreate({ to: 'builder', title: 'Rename the config key', task: 'Rename foo to bar.' });
  const read = await builder.handoffRead({ number: created.number });
  await assert.rejects(builder.handoffAck({ number: created.number, read_sha256: read.body_sha256, result: 'DONE', evidence: [] }), (e) => e.code === 'POLICY');
  await assert.rejects(other.handoffAck({ number: created.number, read_sha256: read.body_sha256, result: 'BLOCKED', evidence: ['x'] }), (e) => e.code === 'POLICY');
  base.gh.issues.get(created.number).body += '\n\nEDIT: also rename baz.'; // human edits the handoff after the agent read it
  await assert.rejects(builder.handoffAck({ number: created.number, read_sha256: read.body_sha256, result: 'DONE', evidence: ['done'] }), (e) => e.code === 'READBACK_MISMATCH');
  assert.equal(base.gh.comments.size, 0, 'nothing was posted');
  const fresh = await builder.handoffRead({ number: created.number });
  assert.equal((await builder.handoffAck({ number: created.number, read_sha256: fresh.body_sha256, result: 'PARTIAL', evidence: ['renamed foo'] })).status, 'CONFIRMED');
  await assert.rejects(base.mailbox.handoffCreate({ to: 'planner', title: 'Self handoff', task: 'x' }), (e) => e.code === 'POLICY');
  await assert.rejects(base.mailbox.handoffCreate({ to: 'Bad Name', title: 'Bad agent', task: 'x' }), (e) => e.code === 'INPUT');
});

test('handoff: lost response after create is reconciled, not duplicated', async (t) => {
  const base = setup(t, { agent: 'planner', login: 'planner-bot' });
  base.gh.dropNextWrite = true;
  await assert.rejects(base.mailbox.handoffCreate({ to: 'builder', title: 'Write release notes', task: 'Draft notes for v0.2.' }), (e) => e.code === 'UNKNOWN_OUTCOME');
  assert.equal(base.gh.issues.size, 1);
  const r = await base.mailbox.handoffCreate({ to: 'builder', title: 'Write release notes', task: 'Draft notes for v0.2.' });
  assert.equal(r.reconciled, true);
  assert.equal(base.gh.issues.size, 1);
  assert.equal(writes(base.gh).length, 1);
});
