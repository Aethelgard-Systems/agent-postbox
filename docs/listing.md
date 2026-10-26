# Listing in MCP directories (prepared, not published)

| Directory | Status | Who / what |
|---|---|---|
| Glama | `glama.json` ready | Maintainer logs in at glama.ai with GitHub, claims the server, adds build: `npm ci`, dummy config + dummy `AGENT_POSTBOX_TOKEN` (server answers `initialize`/`tools/list` without network), then "Make Release". |
| Official MCP Registry | `server.json`, `mcpName`, `repository` ready | Needs `npm publish` of the same version first, then `mcp-publisher login github` + `mcp-publisher publish`. |
| awesome-mcp-servers | after Glama | PR line: `[Aethelgard-Systems/agent-postbox](https://github.com/Aethelgard-Systems/agent-postbox)` + Glama badge, category Developer Tools. |
| Smithery | later | Only as a local MCPB bundle – a publicly hosted URL contradicts the security model (one token per agent). |

Publishing and registration use the maintainer's own accounts; nothing here publishes automatically.
