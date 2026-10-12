// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand
//
// End-to-end test against the real GitHub API with two separate identities.
// Runs in CI (see .github/workflows/live-test.yml). Needs:
//   DEMO_REPOSITORY   owner/repo of a throwaway test repository
//   BUILDER_TOKEN, BUILDER_LOGIN, REVIEWER_TOKEN, REVIEWER_LOGIN
// Creates one proposal issue and one pull request, then closes both.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitHub, Mailbox, ReceiptStore, parseConfig } from '../src/index.js';

process.on('uncaughtException', (e) => {
  console.log(`::error title=live-test aborted::${String(e.code || '')} ${String(e.message).replace(/\r?\n/g, ' ')}`);
  process.exit(1);
});

const env = (k) => {
  if (!process.env[k]) throw new Error(`missing env ${k}`);
  return process.env[k];
};
const repository = env('DEMO_REPOSITORY');
const [owner, repo] = repository.split('/');
const run = `${new Date().toISOString().slice(0, 16)}-${process.pid}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postbox-live-'));

function agent(name, token, login) {
  const config = parseConfig({ repository, agent: name, login, receiptsFile: path.join(dir, `${name}.json`) });
  const github = new GitHub({ owner, repo, token });
  return { mailbox: new Mailbox({ config, github, receipts: new ReceiptStore(config.receiptsFile) }), token };
}
const builder = agent('builder', env('BUILDER_TOKEN'), env('BUILDER_LOGIN'));
const reviewer = agent('reviewer', env('REVIEWER_TOKEN'), env('REVIEWER_LOGIN'));

// Raw API for test scaffolding the tool deliberately cannot do (branch, PR, cleanup).
async function raw(token, method, p, body) {
  const res = await fetch(`https://api.github.com/repos/${repository}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'agent-postbox-live-test' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${data?.message}`);
  return data;
}

const results = [];
async function check(name, fn, expect) {
  let outcome;
  try {
    const r = await fn();
    outcome = r?.status || 'OK';
  } catch (e) {
    outcome = e.code || `ERROR ${e.message}`;
  }
  const ok = outcome === expect;
  results.push({ ok, name, expect, outcome });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expect}, got ${outcome})`);
  return ok;
}

let issue;
let pr;
try {
  await check('builder doctor', async () => { await builder.mailbox.doctor(); return { status: 'OK' }; }, 'OK');
  await check('reviewer doctor', async () => { await reviewer.mailbox.doctor(); return { status: 'OK' }; }, 'OK');

  await check('builder propose', async () => {
    const r = await builder.mailbox.propose({ title: `Live test proposal ${run}`, body: 'Synthetic proposal created by the agent-postbox live test.', labels: ['to:reviewer'] });
    issue = r.number;
    return r;
  }, 'CONFIRMED');
  await check('duplicate proposal is refused', () => builder.mailbox.propose({ title: `Live test proposal ${run}`, body: 'Another body.' }), 'DUPLICATE');
  await check('reviewer inbox sees the proposal (lists may lag)', async () => {
    for (let i = 0; i < 10; i++) {
      if ((await reviewer.mailbox.inbox()).items.some((x) => x.number === issue)) return { status: 'FOUND' };
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { status: 'MISSING' };
  }, 'FOUND');
  await check('builder claims for itself', () => builder.mailbox.label({ number: issue, add: ['claimed:builder'] }), 'CONFIRMED');
  await check('builder cannot claim for reviewer', () => builder.mailbox.label({ number: issue, add: ['claimed:reviewer'] }), 'POLICY');
  await check('builder cannot set human-only label', () => builder.mailbox.label({ number: issue, add: ['approved'] }), 'POLICY');
  await check('builder comment', () => builder.mailbox.comment({ number: issue, body: `DONE - evidence: live test run ${run}.` }), 'CONFIRMED');
  await check('identical comment is not posted twice', async () => {
    const r = await builder.mailbox.comment({ number: issue, body: `DONE - evidence: live test run ${run}.` });
    return { status: r.replay ? 'REPLAY' : 'POSTED_AGAIN' };
  }, 'REPLAY');
  await check('credential in comment is refused', () => builder.mailbox.comment({ number: issue, body: 'token ghp_' + 'Zx9'.repeat(12) }), 'SECRET');

  // Scaffolding: builder opens a pull request with plain API calls.
  await check('scaffolding: builder opens a PR (raw API)', async () => {
    const main = await raw(builder.token, 'GET', '/git/ref/heads/main');
    const branch = `live-test-${run.replace(/[^0-9a-z-]/gi, '-')}`;
    await raw(builder.token, 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: main.object.sha });
    await raw(builder.token, 'PUT', `/contents/live-test/${branch}.md`, { message: 'live test change', content: Buffer.from(`run ${run}\n`).toString('base64'), branch });
    pr = (await raw(builder.token, 'POST', '/pulls', { title: `Live test PR ${run}`, head: branch, base: 'main', body: 'Synthetic pull request from the agent-postbox live test.' })).number;
    return { status: 'OK' };
  }, 'OK');
  if (!pr) throw new Error('no pull request, skipping review checks');

  await check('builder cannot review its own PR', () => builder.mailbox.review({ number: pr, event: 'APPROVE', body: 'Self approval attempt.' }), 'SELF_REVIEW');
  await check('reviewer requests changes (bound to head)', () => reviewer.mailbox.review({ number: pr, event: 'REQUEST_CHANGES', body: 'Criterion 2 lacks evidence.' }), 'CONFIRMED');
  await check('reviewer approves', () => reviewer.mailbox.review({ number: pr, event: 'APPROVE', body: 'Evidence provided. Approved for a human to merge.' }), 'CONFIRMED');
  await check('reviewer hands back with label', () => reviewer.mailbox.label({ number: pr, add: ['to:builder'] }), 'CONFIRMED');
} catch (e) {
  results.push({ ok: false, name: 'aborted', expect: '-', outcome: e.message });
} finally {
  // Cleanup with raw API (the tool has no close endpoint by design).
  for (const n of [pr, issue].filter(Boolean)) {
    try { await raw(builder.token, 'PATCH', `/issues/${n}`, { state: 'closed' }); } catch (e) { console.log(`cleanup #${n}: ${e.message}`); }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
if (process.env.GITHUB_ACTIONS) {
  // One annotation with all results, readable through the checks API.
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}: expected ${r.expect}, got ${r.outcome}`);
  const level = failed.length ? 'error' : 'notice';
  console.log(`::${level} title=live-test ${results.length - failed.length}/${results.length}::${lines.join('%0A').replace(/\r?\n/g, ' ')}`);
}
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  fs.appendFileSync(summary, `## agent-postbox live test\n\n| Result | Check | Expected | Got |\n|---|---|---|---|\n${results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.name} | ${r.expect} | ${r.outcome} |`).join('\n')}\n`);
}
process.exitCode = failed.length ? 1 : 0;
