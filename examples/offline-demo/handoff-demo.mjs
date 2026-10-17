#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

/**
 * Offline handoff demo (v0.2): a planner hands a task to a builder, the builder
 * acknowledges it with evidence, and every step lands in a signed, hash-chained
 * evidence log that is verified – then tampered with, and verified again.
 * In-memory GitHub, synthetic data, no account, token or network.
 *
 *   npm run demo:handoff        (--slow pauses between steps for screen recordings)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConfig } from '../../src/config.js';
import { EvidenceLog, loadPublicKey, verify } from '../../src/evidence.js';
import { GitHub } from '../../src/github.js';
import { Mailbox } from '../../src/mailbox.js';
import { ReceiptStore } from '../../src/receipts.js';
import { fakeGitHub } from '../../test/fake-github.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-postbox-handoff-demo-'));
const fake = fakeGitHub({ login: 'planner-bot' });
const gh = fake.state;

function agent(name, login) {
  const config = parseConfig({ repository: 'example-org/example-repo', agent: name, receiptsFile: path.join(dir, `${name}.json`) });
  const github = new GitHub({ owner: config.owner, repo: config.repo, token: `demo-${name}`, fetch: fake.fetchFor(login) });
  const evidence = new EvidenceLog(config.evidenceFile, config.evidenceKeyFile);
  return { mailbox: new Mailbox({ config, github, receipts: new ReceiptStore(config.receiptsFile, { evidence }) }), config };
}
const planner = agent('planner', 'planner-bot');
const builder = agent('builder', 'builder-bot');

const pause = process.argv.includes('--slow') ? 1400 : 0;
const wait = () => new Promise((resolve) => setTimeout(resolve, pause));
let step = 0;
const say = async (who, text) => { if (step) await wait(); console.log(`\n${String(++step).padStart(2)}. ${who.padEnd(8)} ${text}`); };
const ok = (text) => console.log(`    ✔ ${text}`);
const refused = (text) => console.log(`    ✖ ${text}`);
async function expectRefusal(promise, code, label = 'refused') {
  try { await promise; } catch (e) { if (e.code !== code) throw e; refused(`${label}: ${e.code} – ${e.message}`); return; }
  throw new Error(`expected refusal ${code}`);
}

try {
  console.log('agent-postbox handoff demo – verifiable handoffs between two agents. In-memory GitHub, synthetic data.');

  await say('planner', 'hands "Add a CONTRIBUTORS file" to the builder with two acceptance criteria');
  const h = await planner.mailbox.handoffCreate({ to: 'builder', title: 'Add a CONTRIBUTORS file', task: 'Create CONTRIBUTORS.md listing the maintainers.', acceptance: ['CONTRIBUTORS.md exists', 'CI is green'] });
  ok(`${h.status}: issue #${h.number} labelled to:builder + handoff, read back, body sha256 ${h.body_sha256.slice(0, 12)}…`);

  await say('builder', 'reads the handoff – and gets the hash of exactly what it read');
  const read = await builder.mailbox.handoffRead({ number: h.number });
  ok(`to: ${read.to.join(', ')} · acknowledged: ${read.acknowledged} · body_sha256 ${read.body_sha256.slice(0, 12)}…`);

  await say('builder', 'tries to acknowledge DONE without any evidence');
  await expectRefusal(builder.mailbox.handoffAck({ number: h.number, read_sha256: read.body_sha256, result: 'DONE', evidence: [] }), 'POLICY');

  await say('human', 'edits the handoff while the builder is working (adds a third criterion)');
  gh.issues.get(h.number).body += '\n- [ ] also add a NOTICE line';

  await say('builder', 'acknowledges DONE against the text it read earlier');
  await expectRefusal(builder.mailbox.handoffAck({ number: h.number, read_sha256: read.body_sha256, result: 'DONE', evidence: ['PR #2', 'tests 12/12'] }), 'READBACK_MISMATCH', 'stopped');
  console.log('    … the ack is bound to the handoff text. Changed text = read it again.');

  await say('builder', 'reads again and acknowledges with evidence');
  const fresh = await builder.mailbox.handoffRead({ number: h.number });
  const ack = await builder.mailbox.handoffAck({ number: h.number, read_sha256: fresh.body_sha256, result: 'DONE', evidence: ['https://example.invalid/example-org/example-repo/pull/2', 'tests: 12 passed, 0 failed', 'NOTICE line added'] });
  ok(`${ack.status}: acknowledgement comment read back before it counted`);
  const after = await planner.mailbox.handoffRead({ number: h.number });
  ok(`planner sees: acknowledged=${after.acknowledged}, result=${after.acks[0].result}, by ${after.acks[0].author}`);

  await say('human', 'verifies the evidence logs of both agents');
  for (const a of [planner, builder]) {
    const v = verify(a.config.evidenceFile, loadPublicKey(`${a.config.evidenceKeyFile}.pub`));
    ok(`${a.config.agent}: ${v.ok ? 'OK' : 'TAMPERED'} – ${v.entries} signed, chained entries`);
  }
  for (const line of fs.readFileSync(builder.config.evidenceFile, 'utf8').trim().split('\n')) {
    const e = JSON.parse(line);
    console.log(`      #${e.seq} ${e.event.padEnd(9)} ${e.tool.padEnd(12)} ${e.summary.padEnd(22)} readback=${e.readback || '-'}`);
  }

  await say('someone', 'edits one line of the builder\'s evidence log');
  const lines = fs.readFileSync(builder.config.evidenceFile, 'utf8').trim().split('\n');
  const e = JSON.parse(lines[1]); e.readback = 'ok'; e.event = 'CONFIRMED'; e.note = 'edited after the fact'; lines[1] = JSON.stringify(e);
  fs.writeFileSync(builder.config.evidenceFile, lines.join('\n') + '\n');
  const v = verify(builder.config.evidenceFile, loadPublicKey(`${builder.config.evidenceKeyFile}.pub`));
  refused(`verify: ${v.ok ? 'OK' : 'TAMPERED'} – ${v.problems.map((p) => `line ${p.line}: ${p.reason}`).join('; ')}`);

  console.log('\nResult: 1 handoff, 1 acknowledgement bound to the text as read, 2 unsafe acks refused, tampering detected.');
  console.log('Next: agent-postbox serve --transport http, then point two MCP clients at it – docs/evidence-format.md explains the log.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
