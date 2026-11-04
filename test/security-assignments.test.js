// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanBody, cleanTitle, findSecrets } from '../src/sanitize.js';
import { setup, writes } from './helpers.js';

test('prefixed credential assignments are blocked in bodies and titles', () => {
  for (const key of ['db_password', 'db-password', 'DB_PASSWORD', 'prod_db_password', 'db_passwd',
    'db_secret', 'service_api_key', 'service-api-key', 'access_token', 'service_access_token', 'oauth_client_secret']) {
    const text = `${key}=syntheticpass`;
    assert.ok(findSecrets(text).includes('assignment'), key);
    assert.throws(() => cleanBody(text), { code: 'SECRET' }, key);
    assert.throws(() => cleanTitle(text), { code: 'SECRET' }, key);
  }
  assert.throws(() => cleanBody('db_password: "syntheticpass"'), { code: 'SECRET' });
});

test('unrelated identifiers and ordinary engineering text stay usable', () => {
  for (const text of ['access_count=123456789', 'db_username=syntheticuser',
    'password_policy=minimumlength', 'db_password_hint=synthetichint',
    'Please update the database connection documentation.']) {
    assert.deepEqual(findSecrets(text), [], text);
    assert.equal(cleanBody(text), text);
    assert.equal(cleanTitle(text), text);
  }
});

test('a prefixed credential cannot reach the GitHub write path', async (t) => {
  const { mailbox, gh } = setup(t);
  gh.addIssue(1, { labels: [{ name: 'to:agent-a' }] });
  await assert.rejects(mailbox.comment({ number: 1, body: 'db_password=syntheticpass' }), { code: 'SECRET' });
  assert.equal(writes(gh).length, 0);
});
