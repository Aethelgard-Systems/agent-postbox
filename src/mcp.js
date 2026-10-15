// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { PostboxError } from './errors.js';
import { validate } from './schema.js';

/**
 * Minimal Model Context Protocol server (tools only). Transports: stdio
 * (newline-delimited JSON-RPC 2.0) and, since v0.2, Streamable HTTP in its
 * stateless JSON form (POST /mcp, one JSON-RPC message per request, no SSE).
 * Implemented without the SDK to keep the package free of runtime dependencies.
 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const MAX_LINE = 1_000_000;
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function createServer({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function callTool(params) {
    const tool = byName.get(params?.name);
    if (!tool) return { content: [{ type: 'text', text: JSON.stringify({ error: 'INPUT', message: `unknown tool: ${params?.name}` }) }], isError: true };
    try {
      const args = validate(tool.inputSchema, params.arguments ?? {});
      const result = await tool.run(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    } catch (e) {
      const payload = e instanceof PostboxError ? e.toJSON() : { error: 'INTERNAL', message: 'internal error' };
      if (!(e instanceof PostboxError)) process.stderr.write(`agent-postbox: ${e.stack || e}\n`);
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
    }
  }

  /** Returns the response object, or null for notifications. */
  async function handle(msg) {
    if (Array.isArray(msg)) return rpcError(null, -32600, 'batch requests are not supported');
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'invalid request');
    const isNotification = msg.id === undefined;
    const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: tools.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })) });
      case 'tools/call':
        return reply(await callTool(msg.params));
      default:
        if (msg.method.startsWith('notifications/')) return null;
        return isNotification ? null : rpcError(msg.id, -32601, `method not found: ${msg.method}`);
    }
  }

  return { handle };
}

export function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const write = (obj) => output.write(JSON.stringify(obj) + '\n');
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    if (line.length > MAX_LINE) {
      write(rpcError(null, -32600, 'request too large'));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write(rpcError(null, -32700, 'parse error'));
      return;
    }
    const res = await server.handle(msg);
    if (res) write(res);
  });
  return new Promise((resolve) => rl.on('close', resolve));
}

const MAX_BODY = 1_000_000;

/**
 * Streamable HTTP transport (stateless, JSON responses only). Binds to
 * 127.0.0.1 by default. If `token` is set, every request must carry
 * `Authorization: Bearer <token>`; without a token the server refuses to bind
 * to anything but loopback. GET/DELETE on /mcp answer 405 (no SSE streams).
 */
export function serveHttp(server, { host = '127.0.0.1', port = 8471, path = '/mcp', token = null, listen = true } = {}) {
  if (!token && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('refusing to bind a non-loopback address without AGENT_POSTBOX_HTTP_TOKEN');
  const authorized = (req) => {
    if (!token) return true;
    const h = req.headers.authorization || '';
    const given = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    return given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  };
  const send = (res, status, obj) => {
    const body = obj === undefined ? '' : JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const srv = http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname !== path) return send(res, 404, { error: 'not found' });
    if (!authorized(req)) {
      res.setHeader('www-authenticate', 'Bearer');
      return send(res, 401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only (stateless JSON, no SSE)' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, rpcError(null, -32600, 'request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, rpcError(null, -32700, 'parse error'));
      }
      const out = await server.handle(msg);
      if (out === null) return send(res, 202);
      send(res, out.error && out.id === null ? 400 : 200, out);
    });
  });
  if (!listen) return srv;
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(port, host, () => resolve(srv));
  });
}
