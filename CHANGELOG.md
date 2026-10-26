# Changelog

All notable changes to agent-postbox. The format follows Keep a Changelog; versions follow SemVer.

## [Unreleased]

## [0.2.1] – 2026-10-26

### Changed
- `serve` over **stdio** now starts without a config file or token: `initialize` and `tools/list` work (needed by MCP
  clients and directory checks such as Glama), and every tool call returns the original `CONFIG`/`TOKEN` error. Nothing
  is read from or written to GitHub without a valid setup. `serve --transport http` still refuses to start (#19).

### Added
- `Dockerfile` (node:22-alpine, non-root) that starts the stdio server for directory checks.
- MCP Registry and Glama listing metadata: `mcpName` and `repository` in `package.json`, `server.json` (official MCP
  Registry), `glama.json` and `docs/listing.md` (#17).
- `docs/evidence/live-test-2026-10.md`: live test of v0.2.0 with real identities against the real GitHub API (#18).
- `docs/threat-model.md`: actors, assets, trust boundaries and attack → control → remaining risk for 11 cases; linked
  from the README security section (#20).

### Compatibility
- No breaking changes, no new runtime dependencies. Configuration, receipt and evidence files are unchanged.

## [0.2.0] – 2026-10-19 "Verifiable handoffs for MCP agents"

### Added
- **Handoff tools** `handoff_create`, `handoff_read`, `handoff_ack`: a handoff is an issue addressed to one agent
  (`to:<agent>` + `handoff`) with a task and acceptance criteria. `handoff_read` returns `body_sha256`; `handoff_ack`
  is bound to that hash and refused if the handoff changed since it was read (`READBACK_MISMATCH`). `DONE` requires
  evidence. The acknowledgement comment is receipted and read back like every write. CLI: `handoff create|read|ack`.
- **Streamable HTTP transport** (stateless JSON, `POST /mcp`): `agent-postbox serve --transport http [--host] [--port]`.
  Loopback by default; other hosts require `AGENT_POSTBOX_HTTP_TOKEN` (Bearer). Browser hardening: `Content-Type:
  application/json` is required (415 otherwise), the `Host` header must name the server (403 – defeats DNS rebinding),
  requests carrying an `Origin` header are refused unless allowlisted (`AGENT_POSTBOX_HTTP_ORIGINS`, comma-separated), no CORS preflight.
- **Evidence log** (`<receipts>.evidence.jsonl`): every receipt state change as a hash-chained, Ed25519-signed entry
  in the shared *evidence-v1* format (`docs/evidence-format.md`). `agent-postbox evidence verify` detects modified,
  removed, reordered, inserted, forged and truncated entries; `evidence key` prints the public key.
  Config: `evidence: false` disables it; `evidenceFile`, `evidenceKeyFile`, `handoffLabel`.
- Offline handoff demo: `npm run demo:handoff`.
- Library exports: `serveHttp`, `EvidenceLog`, `verifyEvidence`, `generateEvidenceKey`, `canonical`.

### Changed
- `tools/list` now returns nine tools; the original six come first and are unchanged. The tool definitions grew from
  under 4,000 to under 4,500 characters.
- Daily write budget counts handoffs and acknowledgements as writes.

### Behaviour changes
- The evidence log is **on by default**: after upgrading, the first write creates `<receipts>.evidence.jsonl` and an
  Ed25519 key `<receipts>.evidence-key.pem` (0600) next to the receipts file. Set `"evidence": false` to opt out.
- `ts` in evidence entries is integer milliseconds; the `.head` sidecar is a signed `{hash, seq, sig}` object.

### Compatibility
- v0.1 configuration and receipt files load unchanged (`test/compat.test.js`). No runtime dependencies.

## [0.1.0] – 2026-10-14
- First public release: MCP server (stdio) and CLI with inbox, read, comment, label, propose, review; receipts with
  read-back and reconciliation; four-eyes review; protected labels; secret filter; daily limits; offline demo.
