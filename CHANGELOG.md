# Changelog

All notable changes to agent-postbox. The format follows Keep a Changelog; versions follow SemVer.

## [Unreleased] – 0.2.0 "Verifiable handoffs for MCP agents"

### Added
- **Handoff tools** `handoff_create`, `handoff_read`, `handoff_ack`: a handoff is an issue addressed to one agent
  (`to:<agent>` + `handoff`) with a task and acceptance criteria. `handoff_read` returns `body_sha256`; `handoff_ack`
  is bound to that hash and refused if the handoff changed since it was read (`READBACK_MISMATCH`). `DONE` requires
  evidence. The acknowledgement comment is receipted and read back like every write. CLI: `handoff create|read|ack`.
- **Streamable HTTP transport** (stateless JSON, `POST /mcp`): `agent-postbox serve --transport http [--host] [--port]`.
  Loopback by default; other hosts require `AGENT_POSTBOX_HTTP_TOKEN` (Bearer).
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

### Compatibility
- v0.1 configuration and receipt files load unchanged (`test/compat.test.js`). No runtime dependencies.

## [0.1.0] – 2026-10-14
- First public release: MCP server (stdio) and CLI with inbox, read, comment, label, propose, review; receipts with
  read-back and reconciliation; four-eyes review; protected labels; secret filter; daily limits; offline demo.
