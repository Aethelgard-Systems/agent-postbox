# agent-postbox

**Let AI coworkers collaborate through GitHub Issues and pull requests – with bounded writes, receipts and four-eyes review.**

You already have a durable, auditable, human-readable coordination system: your GitHub repository. `agent-postbox` turns it into a mailbox for AI agents, so they can hand work to each other, report results and review each other's pull requests, while every write stays small, verified and attributable, and every decision stays with a human.

It is a small [Model Context Protocol](https://modelcontextprotocol.io) server plus a CLI. Zero runtime dependencies.

```text
human ──opens issue──▶  #12  [to:builder]
builder ── inbox ─────▶ claims (claimed:builder), works, opens PR #13 [to:reviewer]
reviewer ─ review ────▶ REQUEST_CHANGES on #13 @ head commit (cannot review its own PR)
builder ── comment ───▶ evidence: tests, output, links
human ───────────────▶ merges. Agents cannot merge, close, or set authority labels.
```

## Why

Multi-agent setups usually fail in boring ways: an agent claims it posted something it did not, posts the same thing twice after a timeout, approves its own work, treats text in an issue as an order, or leaks a token into a comment. `agent-postbox` addresses exactly those failure modes and nothing else.

| Problem | What agent-postbox does |
|---|---|
| "I posted it" – but nothing is there | **Read-back**: every write is fetched again and compared before it counts as done |
| Timeout → retry → duplicate | **Write receipts**: `ATTEMPTED` is stored before sending, `CONFIRMED` after read-back. An unknown outcome is reconciled only if GitHub shows the exact write by the agent's own identity; otherwise it stays blocked until a human resolves it |
| Agent approves its own PR | **Four-eyes**: any review (including comments) is refused when the PR author is the token's own identity, which is verified against GitHub; reviews are bound to the head commit |
| Agent decides things it should only propose | **Authority separation**: protected labels (e.g. `approved`, `decision:*`) are human-only; proposals carry an explicit no-authority footer |
| Agent can do anything the token can | **Bounded writes**: a fixed endpoint allowlist – no merge, close, delete, body edit, settings or code access |
| Token or password ends up in a comment | **Secret filter** on every title and body (best effort, see Security) |
| Issue text tries to instruct the agent | All read content is marked as **untrusted data** |
| Runaway agent | **Daily limits** for writes and proposals |

## Non-goals

Not an agent framework, not a runtime, no database, no dashboard, no worktree orchestration, no role model. Bring your own agents; agent-postbox is only the mailbox.

## Tools

| Tool | Effect |
|---|---|
| `inbox` | Issues/PRs labelled `to:<this-agent>` |
| `read` | One issue or PR with comments (untrusted content) |
| `comment` | One receipted, read-back comment |
| `label` | Add/remove labels: `to:<any-agent>` (hand off), `claimed:<self>`, labels from `allowedLabels` |
| `propose` | New issue labelled `proposal`, duplicate check, daily limit |
| `review` | PR review (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) bound to the head commit; refused on own PRs |

The complete tool list costs well under 4,000 characters of model context (tested).

## Quick start

1. **One identity per agent.** Each agent needs its own GitHub identity so that authorship and four-eyes review are real – a dedicated machine account with a [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) limited to one repository (*Issues: read/write*, *Pull requests: read/write*, *Metadata: read*), or a GitHub App installation token. Classic tokens are refused by default.
2. **Install** (Node.js ≥ 20):
   ```sh
   npm install -g github:Aethelgard-Systems/agent-postbox
   ```
3. **Configure** – `agent-postbox.config.json`:
   ```json
   {
     "repository": "example-org/example-repo",
     "agent": "builder",
     "tokenEnv": "AGENT_POSTBOX_TOKEN",
     "allowedLabels": ["needs-review", "blocked", "question"],
     "protectedLabels": ["approved", "decision:*"],
     "limits": { "writesPerDay": 50, "proposalsPerDay": 5 }
   }
   ```
4. **Check** without writing anything:
   ```sh
   AGENT_POSTBOX_TOKEN=... agent-postbox doctor
   ```
5. **Connect your MCP client** (example for clients using the common `mcpServers` format):
   ```json
   {
     "mcpServers": {
       "agent-postbox": {
         "command": "agent-postbox",
         "args": ["serve", "--config", "/path/to/agent-postbox.config.json"],
         "env": { "AGENT_POSTBOX_TOKEN": "<this agent's token>" }
       }
     }
   }
   ```
6. Copy [`templates/AGENTS.md`](templates/AGENTS.md) and [`templates/pull_request_template.md`](templates/pull_request_template.md) into your repository so agents and humans share one protocol.

A walk-through with two agents reviewing each other is in [`examples/two-agent-review`](examples/two-agent-review/).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `repository` | – | `owner/repo`; the only repository this instance can touch |
| `agent` | – | This agent's name (`[a-z0-9-]`) |
| `login` | from `GET /user` | GitHub login of the token; required for GitHub App tokens (e.g. `my-app[bot]`) |
| `tokenEnv` | `AGENT_POSTBOX_TOKEN` | Environment variable holding the token |
| `addressPrefix` | `to:` | Label prefix for addressing agents |
| `claimPrefix` | `claimed:` | Label prefix for claiming work (self only) |
| `proposalLabel` | `proposal` | Label for agent proposals |
| `allowedLabels` | `needs-review`, `blocked`, `question` | Extra labels agents may set (`*` suffix = prefix match) |
| `protectedLabels` | `approved`, `decision:*` | Human-only labels; agents can neither add nor remove them |
| `limits` | 50 writes, 5 proposals per day, 6000-char body, 120-char title | Per agent |
| `receiptsFile` | `$XDG_STATE_HOME/agent-postbox/<owner>-<repo>-<agent>.json` | Local receipt store |
| `allowClassicToken` | `false` | Accept classic PATs (not recommended) |

## CLI

```text
agent-postbox doctor | inbox | read <n> | comment <n> --body ... | label <n> --add a --remove b
agent-postbox propose --title ... --body-file ... | review <n> --event approve|request-changes|comment --body ...
agent-postbox receipts list | receipts resolve <key> --as confirmed|failed
agent-postbox serve
```

All output is JSON. Refusals exit with code 2 and a stable error code (`POLICY`, `SECRET`, `LIMIT`, `SELF_REVIEW`, `UNKNOWN_OUTCOME`, `READBACK_MISMATCH`, …).

## Known limits (v0.1)

- An identical comment text on the same issue is posted only once (replay protection); add context to make a new comment distinct.
- Duplicate-title checks and reconciliation scan up to 1,000 items.
- Adding a `to:<agent>` label creates that label in the repository if it does not exist yet.
- Reviews and comments are not edited or deleted by agent-postbox – by design.
- When the MCP server and the CLI share a receipt file, a lock conflict can pause the server for up to 5 seconds, and concurrent processes may exceed a daily limit by a few writes.

## Security model

agent-postbox is designed to **reduce** the risk of common multi-agent failures. It is not a sandbox.

- **The token is the real boundary.** agent-postbox cannot stop someone who has the token from calling GitHub directly. Use one narrowly scoped token per agent and protect `main` with branch protection and required reviews, so merging stays human.
- **Four-eyes depends on separate identities.** If two agents share a token, GitHub sees one author and the four-eyes check cannot help.
- **The secret filter is best effort.** It catches common token formats and high-entropy strings; it will miss some secrets and occasionally flag harmless text.
- **Untrusted content stays untrusted.** agent-postbox labels everything it reads as data. Whether your agent respects that depends on your agent.
- **Receipts are a local hint, GitHub is the truth.** The receipt file is written atomically with mode `0600` under a lock file, so the MCP server and the CLI can share it. It contains keys, states, issue numbers, links and HTTP status codes – no message bodies, titles or tokens.
- **Markers are invisible, not secret.** Each write carries an HTML comment marker. It is only trusted when GitHub shows it on content authored by the agent's own identity with the exact expected text.
- **Limits are local.** Daily limits count the writes in this agent's receipt file on this machine; they are a brake, not a quota enforced by GitHub.
- **No telemetry, no hosted service.** agent-postbox talks only to `api.github.com` with the token you provide.

Please report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## AI-assisted development

This project has been developed with the assistance of generative AI tools. AI-generated suggestions are reviewed, selected, modified and integrated by the maintainer before inclusion. No third-party proprietary source code is knowingly included in the project. AI assistance does not alter the licensing terms of this project or of its third-party dependencies.

## Disclaimer

This project is free and open-source software provided under the Apache License 2.0.

The software is provided on an "AS IS" basis. No representation or warranty is made that it is suitable for any particular production, security, compliance, legal, or business purpose.

This software can interact with GitHub resources and may perform write operations when configured to do so. Users are responsible for reviewing the permissions they grant, their configuration, and the effects of automated or AI-initiated actions before using the software with important repositories or production workflows.

Security mechanisms, including permission limits, verification steps and secret filtering, reduce risk but must not be treated as a guarantee that every unsafe action, credential, secret, or unintended output will be detected or prevented.

Nothing in this notice excludes or limits liability to the extent that such exclusion or limitation is prohibited by applicable law.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Marco Gernand. Contributions are welcome under the [Developer Certificate of Origin](CONTRIBUTING.md).
