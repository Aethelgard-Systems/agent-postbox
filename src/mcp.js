// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import readline from 'node:readline';
import { CountersignError } from './errors.js';
import { validate } from './schema.js';

/**
 * Minimal Model Context Protocol server (tools only, stdio transport,
 * newline-delimited JSON-RPC 2.0). Implemented without the SDK to keep the
 * package free of runtime dependencies.
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
      const payload = e instanceof CountersignError ? e.toJSON() : { error: 'INTERNAL', message: 'internal error' };
      if (!(e instanceof CountersignError)) process.stderr.write(`countersign: ${e.stack || e}\n`);
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
