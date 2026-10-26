// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../src/mcp.js';
import { tools } from '../src/tools.js';
import { setup } from './helpers.js';

test('MCP: initialize, list tools, call tool, structured errors', async (t) => {
  const { mailbox, gh } = setup(t);
  gh.addIssue(3, { labels: [{ name: 'to:agent-a' }] });
  const server = createServer({ name: 'agent-postbox', version: '0.0.0-test', tools: tools(mailbox) });
  const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((x) => x.name), ['inbox', 'read', 'comment', 'label', 'propose', 'review', 'handoff_create', 'handoff_read', 'handoff_ack']);
  const call = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inbox', arguments: {} } });
  assert.equal(call.result.isError, undefined);
  assert.equal(call.result.structuredContent.items[0].number, 3);
  const bad = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'comment', arguments: { number: 3, body: 'x', repo: 'other/repo' } } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /not allowed/);
  const policy = await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'label', arguments: { number: 3, add: ['approved'] } } });
  assert.equal(JSON.parse(policy.result.content[0].text).error, 'POLICY');
  const unknown = await server.handle({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
  assert.equal(unknown.error.code, -32601);
});

test('MCP: tool descriptions stay small (context budget)', (t) => {
  const { mailbox } = setup(t);
  const size = JSON.stringify(tools(mailbox).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length;
  assert.ok(size < 4500, `tool definitions are ${size} chars`);
});

test('CLI: serve speaks MCP over stdio', async (t) => {
  const { dir } = setup(t);
  const cfg = path.join(dir, 'agent-postbox.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ repository: 'example-org/example-repo', agent: 'agent-a', receiptsFile: path.join(dir, 'r.json') }));
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [cli, 'serve', '--config', cfg], { env: { ...process.env, AGENT_POSTBOX_TOKEN: 'synthetic' } });
  t.after(() => child.kill());
  let out = '';
  const reply = new Promise((resolve) => child.stdout.on('data', (b) => { out += b; if (out.includes('\n')) resolve(JSON.parse(out.split('\n')[0])); }));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  const res = await reply;
  assert.equal(res.result.tools.length, 9);
});

test('MCP: inherited property names are rejected as input errors', async (t) => {
  const { mailbox } = setup(t);
  const server = createServer({ name: 'agent-postbox', version: '0', tools: tools(mailbox) });
  for (const k of ['__proto__', 'constructor', 'toString']) {
    const args = JSON.parse(`{"number": 1, "${k}": {}}`);
    const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read', arguments: args } });
    assert.equal(JSON.parse(r.result.content[0].text).error, 'INPUT', k);
  }
});

test('CLI: stdio serve without config/token answers initialize and tools/list, tool calls report CONFIG', async (t) => {
  const { dir } = setup(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const env = { ...process.env };
  delete env.AGENT_POSTBOX_TOKEN; delete env.AGENT_POSTBOX_CONFIG;
  const child = spawn(process.execPath, [cli, 'serve'], { cwd: dir, env });
  t.after(() => child.kill());
  let out = '';
  const next = () => new Promise((resolve) => {
    const check = () => { const i = out.indexOf('\n'); if (i >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); resolve(JSON.parse(l)); } else child.stdout.once('data', (b) => { out += b; check(); }); };
    check();
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
  assert.equal((await next()).result.protocolVersion, '2025-03-26');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  assert.equal((await next()).result.tools.length, 9);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inbox', arguments: {} } }) + '\n');
  const call = await next();
  assert.equal(call.result.isError, true);
  assert.equal(JSON.parse(call.result.content[0].text).error, 'CONFIG');
});

test('CLI: http serve without config still refuses to start', async (t) => {
  const { dir } = setup(t);
  const cli = new URL('../src/cli.js', import.meta.url).pathname;
  const env = { ...process.env };
  delete env.AGENT_POSTBOX_TOKEN; delete env.AGENT_POSTBOX_CONFIG;
  const child = spawn(process.execPath, [cli, 'serve', '--transport', 'http', '--port', '18471'], { cwd: dir, env });
  t.after(() => child.kill());
  let err = '';
  child.stderr.on('data', (b) => { err += b; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(err, /CONFIG|config/);
});
