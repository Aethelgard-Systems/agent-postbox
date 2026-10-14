#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

/**
 * Offline demo: two agents (builder, reviewer) and a human work through one
 * issue and one pull request – against an in-memory GitHub, so no account,
 * token or network is needed. Synthetic data only.
 *
 *   npm run demo
 *
 * The same flow against a real repository: examples/two-agent-review/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConfig } from '../../src/config.js';
import { GitHub } from '../../src/github.js';
import { Mailbox } from '../../src/mailbox.js';
import { ReceiptStore } from '../../src/receipts.js';
import { fakeGitHub } from '../../test/fake-github.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-postbox-demo-'));
const fake = fakeGitHub({ login: 'builder-bot' });
const gh = fake.state;

function agent(name, login) {
  const config = parseConfig({ repository: 'example-org/example-repo', agent: name, receiptsFile: path.join(dir, `${name}.json`) });
  const github = new GitHub({ owner: config.owner, repo: config.repo, token: `demo-${name}`, fetch: fake.fetchFor(login) });
  return new Mailbox({ config, github, receipts: new ReceiptStore(config.receiptsFile) });
}
const builder = agent('builder', 'builder-bot');
const reviewer = agent('reviewer', 'reviewer-bot');

// --slow pauses between steps, e.g. for screen recordings.
const pause = process.argv.includes('--slow') ? 1400 : 0;
const wait = () => new Promise((resolve) => setTimeout(resolve, pause));
let step = 0;
const say = async (who, text) => {
  if (step) await wait();
  console.log(`\n${String(++step).padStart(2)}. ${who.padEnd(8)} ${text}`);
};
const ok = (text) => console.log(`    ✔ ${text}`);
const refused = (text) => console.log(`    ✖ ${text}`);
async function expectRefusal(promise, code, label = 'refused') {
  try {
    await promise;
  } catch (e) {
    if (e.code !== code) throw e;
    refused(`${label}: ${e.code} – ${e.message}`);
    return;
  }
  throw new Error(`expected refusal ${code}, but the write went through`);
}

try {
  console.log('agent-postbox offline demo – in-memory GitHub, synthetic data, nothing leaves this machine.');

  await say('human', 'opens issue #1 "Add a CONTRIBUTORS file" for the builder');
  gh.addIssue(1, { title: 'Add a CONTRIBUTORS file', labels: [{ name: 'to:builder' }] });

  await say('builder', 'checks its inbox and claims the issue');
  const inbox = await builder.inbox();
  ok(`inbox: ${inbox.items.map((i) => `#${i.number} ${i.title}`).join(', ')}`);
  await builder.label({ number: 1, add: ['claimed:builder'] });
  ok('label claimed:builder set and read back');

  await say('builder', 'opens PR #2 with its own git tooling and hands it to the reviewer');
  gh.addIssue(2, { title: 'Add CONTRIBUTORS', user: { login: 'builder-bot' }, pull: { sha: 'a'.repeat(40) } });
  await builder.label({ number: 2, add: ['to:reviewer', 'needs-review'] });
  ok('PR #2 addressed to:reviewer');

  await say('reviewer', 'reviews PR #2 and requests changes');
  const r1 = await reviewer.review({ number: 2, event: 'REQUEST_CHANGES', body: 'Acceptance criterion 2 has no evidence yet.' });
  ok(`${r1.status}: changes requested, bound to head commit ${'a'.repeat(7)}`);

  await say('builder', 'pushes a fix and reports evidence – but the network drops right after the write');
  gh.issues.get(2).pull.sha = 'b'.repeat(40);
  gh.dropNextWrite = true;
  const evidence = 'DONE – evidence: tests 12/12 passed, CONTRIBUTORS lists 3 names.';
  await expectRefusal(builder.comment({ number: 2, body: evidence }), 'UNKNOWN_OUTCOME', 'stopped');
  console.log('    … the agent does not know whether its comment arrived. A naive retry would post it twice.');

  await say('builder', 'retries the same comment');
  const c = await builder.comment({ number: 2, body: evidence });
  ok(`${c.status}${c.reconciled ? ' (reconciled: found its own write on GitHub instead of posting again)' : ''}`);
  ok(`comments on PR #2: ${[...gh.comments.values()].filter((x) => x.issue === 2).length} – no duplicate`);

  await say('reviewer', 'approves the new head commit');
  const r2 = await reviewer.review({ number: 2, event: 'APPROVE', body: 'Evidence checked, criteria met.' });
  ok(`${r2.status}: approved at ${'b'.repeat(7)}`);

  await say('builder', 'tries to approve its own pull request');
  await expectRefusal(builder.review({ number: 2, event: 'APPROVE', body: 'Looks good to me.' }), 'SELF_REVIEW');

  await say('builder', 'tries to set the human-only label "approved"');
  await expectRefusal(builder.label({ number: 2, add: ['approved'] }), 'POLICY');

  await say('builder', 'tries to paste a token into a comment');
  await expectRefusal(builder.comment({ number: 2, body: `debug: ${'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}` }), 'SECRET');

  await say('human', 'merges PR #2 – agents have no merge endpoint');

  const receipts = [...builder.receipts.list(), ...reviewer.receipts.list()];
  const confirmed = receipts.filter((r) => r.state === 'CONFIRMED').length;
  const bodies = [...gh.comments.values()].map((x) => x.body);
  const duplicates = bodies.length - new Set(bodies).size;
  console.log(`\nResult: ${confirmed}/${receipts.length} writes CONFIRMED by read-back, ${duplicates} duplicates, 3 unsafe actions refused.`);
  console.log('Next: run the same flow on a real test repository – examples/two-agent-review/README.md');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
