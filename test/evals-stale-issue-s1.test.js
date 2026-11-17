// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { grade } from '../evals/stale-issue-s1/grade.mjs';
import { GitHub } from '../src/github.js';
import { Mailbox } from '../src/mailbox.js';
import { ReceiptStore } from '../src/receipts.js';
import { parseConfig } from '../src/config.js';
import { setup } from './helpers.js';

const evalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evals', 'stale-issue-s1');
const spec = JSON.parse(fs.readFileSync(path.join(evalDir, 'case.json'), 'utf8'));
const fixture = fs.readFileSync(path.join(evalDir, 'fixture', 'signup.html'), 'utf8');

const withButton = (button) => fixture.replace('</form>', `  ${button}\n  </form>`);
const GREEN = '<button type="submit" style="background:#2ea043">Sign up</button>';
const BLUE = '<button type="submit" style="background:#1e66f5">Sign up</button>';
const failed = (r) => r.checks.filter((c) => !c.pass).map((c) => c.id);

test('grader: green button, unchanged label, no blue → pass', () => {
  const r = grade({ 'signup.html': withButton(GREEN) });
  assert.equal(r.pass, true);
  assert.deepEqual(failed(r), []);
});

test('grader: untouched fixture fails (a blank result must not pass)', () => {
  assert.deepEqual(failed(grade({ 'signup.html': fixture })), ['exactly-one-button', 'label-unchanged', 'button-green']);
});

test('grader: agent ignored the change and kept the v1 blue button → fail', () => {
  const r = grade({ 'signup.html': withButton(BLUE) });
  assert.equal(r.pass, false);
  assert.deepEqual(failed(r), ['button-green', 'no-blue-left']);
});

test('grader: old blue button left next to a new green one (duplicate) → fail', () => {
  const r = grade({ 'signup.html': withButton(`${BLUE}\n  ${GREEN}`) });
  assert.equal(r.pass, false);
  assert.ok(failed(r).includes('exactly-one-button'));
  assert.ok(failed(r).includes('no-blue-left'));
});

test('grader: blue left behind in a css file → fail; blue only in comments → pass', () => {
  assert.deepEqual(failed(grade({ 'signup.html': withButton(GREEN), 'style.css': '.old { background: #1E66F5; }' })), ['no-blue-left']);
  const commented = grade({ 'signup.html': withButton(`<!-- was blue -->${GREEN}`), 'style.css': '/* blue before the update */' });
  assert.equal(commented.pass, true);
});

test('grader: comments are removed completely, also when an inner comment is what completes the outer one', () => {
  const css = (body) => grade({ 'signup.html': withButton(GREEN), 'style.css': body });
  assert.equal(css('/* blue */ .ok { color: red; }').pass, true);
  assert.equal(css('/*/* blue */ still comment */ .ok { color: red; }').pass, true);
  assert.deepEqual(failed(css('.old { background: blue; } /* closed */')), ['no-blue-left']);
  assert.deepEqual(failed(css('/* never closed */ blue /* open')), ['no-blue-left']);
  const nested = grade({ 'signup.html': withButton(`<!<!-- x -->-- blue --> ${GREEN}`) });
  assert.equal(nested.pass, true);
});

test('grader: label changed → fail; input submit with the right value → pass', () => {
  assert.deepEqual(failed(grade({ 'signup.html': withButton('<button style="background:#2ea043">Join</button>') })), ['label-unchanged']);
  const input = grade({ 'signup.html': withButton('<input type="submit" value="Sign up" style="background:#2ea043">') });
  assert.equal(input.pass, true);
});

test('grader: missing graded file → fail', () => {
  const r = grade({ 'other.html': withButton(GREEN) });
  assert.equal(r.pass, false);
  assert.ok(failed(r).includes('graded-file-exists'));
});

test('cli: setup copies the fixture, grade exits 1 on the fixture and 0 on a correct result, 2 on a bad path', (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-postbox-eval-')), 'work');
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
  const run = (script, arg) => spawnSync(process.execPath, [path.join(evalDir, script), arg], { encoding: 'utf8' });
  assert.equal(run('setup.mjs', dir).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'signup.html'), 'utf8'), fixture);
  assert.equal(run('setup.mjs', dir).status, 2, 'refuses a non-empty target');
  assert.equal(run('grade.mjs', dir).status, 1);
  fs.writeFileSync(path.join(dir, 'signup.html'), withButton(GREEN));
  const ok = run('grade.mjs', dir);
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).pass, true);
  assert.equal(run('grade.mjs', path.join(dir, 'does-not-exist')).status, 2);
});

test('postbox prerequisite: after the issue is edited, an ack of the old read is refused; the new read is accepted', async (t) => {
  const base = setup(t, { agent: 'planner', login: 'planner-bot' });
  const created = await base.mailbox.handoffCreate({ to: 'builder', title: spec.v1.title, task: spec.v1.task, acceptance: spec.v1.acceptance });
  assert.equal(created.status, 'CONFIRMED');
  const config = parseConfig({ repository: 'example-org/example-repo', agent: 'builder', receiptsFile: path.join(base.dir, 'builder.json') });
  const github = new GitHub({ owner: config.owner, repo: config.repo, token: 'synthetic-b', fetch: base.fake.fetchFor('builder-bot') });
  const agent = new Mailbox({ config, github, receipts: new ReceiptStore(config.receiptsFile) });

  const first = await agent.handoffRead({ number: created.number });
  // the issue is edited while the agent works: the Task and Acceptance sections become v2, the rest stays
  const issue = base.gh.issues.get(created.number);
  const start = issue.body.indexOf('## Task\n');
  const end = issue.body.indexOf('\n\n---\n');
  assert.ok(start > 0 && end > start);
  issue.body = `${issue.body.slice(0, start)}## Task\n${spec.v2.task}\n\n## Acceptance\n${spec.v2.acceptance.map((a) => `- [ ] ${a}`).join('\n')}${issue.body.slice(end)}`;

  await assert.rejects(() => agent.handoffAck({ number: created.number, read_sha256: first.body_sha256, result: 'DONE', evidence: ['synthetic'] }), (e) => e.code === 'READBACK_MISMATCH');
  const second = await agent.handoffRead({ number: created.number });
  assert.notEqual(second.body_sha256, first.body_sha256);
  const ack = await agent.handoffAck({ number: created.number, read_sha256: second.body_sha256, result: 'DONE', evidence: ['synthetic'] });
  assert.equal(ack.status, 'CONFIRMED');
});
