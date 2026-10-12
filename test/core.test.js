// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseConfig } from '../src/config.js';
import { GitHub } from '../src/github.js';
import { findSecrets } from '../src/sanitize.js';
import { SYNTHETIC_TOKEN, setup } from './helpers.js';

test('config rejects unknown keys and overlapping allowed/protected labels', () => {
  assert.throws(() => parseConfig({ repository: 'a/b', agent: 'x', merge: true }), { code: 'CONFIG' });
  assert.throws(() => parseConfig({ repository: 'a/b', agent: 'x', allowedLabels: ['approved'] }), { code: 'CONFIG' });
  assert.throws(() => parseConfig({ repository: 'nope', agent: 'x' }), { code: 'CONFIG' });
  assert.throws(() => parseConfig({ repository: 'a/b', agent: 'Bad Name' }), { code: 'CONFIG' });
  const c = parseConfig({ repository: 'a/b', agent: 'x' });
  assert.equal(c.limits.proposalsPerDay, 5);
});

test('secret detection catches common credentials and ignores normal engineering text', () => {
  assert.ok(findSecrets('token github_pat_' + 'A'.repeat(20) + '_' + 'b1'.repeat(15)).length);
  assert.ok(findSecrets('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----').length);
  assert.ok(findSecrets('https://user:' + 's3cretpass' + '@example.com/x').length);
  assert.deepEqual(findSecrets('commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39 fixes src/lib/receipt-store/index.js'), []);
  assert.deepEqual(findSecrets('See https://github.com/example-org/example-repo/pull/12 and run npm test.'), []);
});

test('GitHub client refuses endpoints outside the allowlist and other repositories', async (t) => {
  const { github, gh } = setup(t);
  for (const [m, p] of [
    ['PUT', '/repos/example-org/example-repo/pulls/1/merge'],
    ['PATCH', '/repos/example-org/example-repo/issues/1'],
    ['DELETE', '/repos/example-org/example-repo'],
    ['GET', '/repos/example-org/example-repo/contents/README.md'],
    ['POST', '/repos/other-org/other-repo/issues/1/comments'],
    ['GET', '/repos/example-org/example-repo/../other/issues'],
  ]) {
    await assert.rejects(github.request(m, p), { code: 'POLICY' }, `${m} ${p}`);
  }
  assert.equal(gh.calls.length, 0);
});

test('token never appears in error messages', async () => {
  const github = new GitHub({ owner: 'o', repo: 'r', token: SYNTHETIC_TOKEN, fetch: async () => { throw new Error(`boom ${SYNTHETIC_TOKEN}`); } });
  const e = await github.request('GET', '/user').catch((x) => x);
  assert.ok(!e.message.includes(SYNTHETIC_TOKEN));
  assert.ok(!JSON.stringify(github).includes(SYNTHETIC_TOKEN));
});

test('package has no runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.equal(pkg.license, 'Apache-2.0');
});
