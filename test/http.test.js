// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, serveHttp } from '../src/mcp.js';
import { tools } from '../src/tools.js';
import { setup } from './helpers.js';

async function rpc(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

test('HTTP: stateless Streamable HTTP speaks JSON-RPC, refuses GET, batches and bad JSON', async (t) => {
  const { mailbox, gh } = setup(t);
  gh.addIssue(3, { labels: [{ name: 'to:agent-a' }] });
  const server = createServer({ name: 'agent-postbox', version: '0', tools: tools(mailbox) });
  const srv = await serveHttp(server, { host: '127.0.0.1', port: 0 });
  t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  const init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(init.json.result.protocolVersion, '2025-06-18');
  assert.equal((await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const call = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'inbox', arguments: {} } });
  assert.equal(call.json.result.structuredContent.items[0].number, 3);
  assert.equal((await rpc(url, [{ jsonrpc: '2.0', id: 3, method: 'ping' }])).status, 400);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/other`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST', body: '{not json' })).status, 400);
});

test('HTTP: bearer token required when configured; non-loopback bind refused without token', async (t) => {
  const { mailbox } = setup(t);
  const server = createServer({ name: 'agent-postbox', version: '0', tools: tools(mailbox) });
  const srv = await serveHttp(server, { host: '127.0.0.1', port: 0, token: 'synthetic-http-token' });
  t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  assert.equal((await rpc(url, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  assert.equal((await rpc(url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await rpc(url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer synthetic-http-token' })).status, 200);
  assert.throws(() => serveHttp(server, { host: '0.0.0.0', port: 0, listen: false }), /refusing to bind/);
});
