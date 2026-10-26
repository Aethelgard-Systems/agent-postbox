# Listing in MCP directories

| Directory | Status (2026-10-26) | Notes |
|---|---|---|
| npm | **live** – `agent-postbox@0.2.1` | `npm install -g agent-postbox` |
| Official MCP Registry | **live** – `io.github.Aethelgard-Systems/agent-postbox` 0.2.1 | `server.json` + `mcpName` in `package.json` |
| mcpservers.org | **live** (since 2026-10-25) | – |
| Glama | blocked | GitHub sign-in on Glama fails ("Authentication failed"); support contacted. Build: `npm ci`, dummy config + dummy `AGENT_POSTBOX_TOKEN` or the root `Dockerfile` (stdio `serve` starts without config since #19). |
| awesome-mcp-servers | waiting | PR open upstream, needs the Glama score badge. |
| Smithery | later | Only as a local MCPB bundle – a publicly hosted URL contradicts the security model (one token per agent). |

Publishing and registration use the maintainer's own accounts; nothing here publishes automatically.

## Release notes for maintainers (learned with 0.2.1)

- `npm publish` asks for a 2FA web confirmation; on WSL run `npm login`/`npm publish` with `BROWSER=true` and open the link manually.
- `mcp-publisher` 1.8.5 did not keep its login under WSL; 1.8.4 on Windows worked.
- An organisation namespace (`io.github.<org>/…`) needs more than the interactive login: a classic PAT with `read:org`,
  or – recommended for future releases – a publish workflow using GitHub Actions OIDC.
- Publish order: tag → `npm publish` → `mcp-publisher publish` (the registry only stores metadata pointing at npm).
