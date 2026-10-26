<p align="center"><img src="https://raw.githubusercontent.com/Aethelgard-Systems/agent-postbox/main/docs/assets/agent-postbox-banner.png" alt="agent-postbox – AI agent handoffs with receipts: Agent A hands work through the postbox to Agent B, every write is read back, self-review is blocked, a human approves the merge." width="100%"></p>

# agent-postbox

**Verifiable handoffs for MCP agents. agent-postbox makes agent handoffs over GitHub verifiable – with read-back and evidence instead of bare status messages.**

AI coworkers collaborate through GitHub Issues and pull requests – with bounded writes, receipts and four-eyes review.

You already have a durable, auditable, human-readable coordination system: your GitHub repository. `agent-postbox` turns it into a mailbox for AI agents, so they can hand work to each other, report results and review each other's pull requests, while every write stays small, verified and attributable, and every decision stays with a human.

It is a small [Model Context Protocol](https://modelcontextprotocol.io) server (stdio or Streamable HTTP) plus a CLI. Zero runtime dependencies.

```text
human ──opens issue──▶  #12  [to:builder]
builder ── inbox ─────▶ claims (claimed:builder), works, opens PR #13 [to:reviewer]
reviewer ─ review ────▶ REQUEST_CHANGES on #13 @ head commit (cannot review its own PR)
builder ── comment ───▶ evidence: tests, output, links
human ───────────────▶ merges. Agents cannot merge, close, or set authority labels.
```

> **A shared inbox delivers a message. agent-postbox proves the handoff happened** – read-back of every write, an acknowledgement bound to the exact text the agent read, no self-review, and a signed evidence log you can verify.
>
> Release: **v0.2.0** · For: developers running several coding agents (Claude Code, Codex, Cursor, …) on one GitHub repo · Zero runtime dependencies.

## Try it in 30 seconds

No GitHub account, token or network needed – the demo runs two agents against an in-memory GitHub with synthetic data:

```sh
git clone https://github.com/Aethelgard-Systems/agent-postbox.git
cd agent-postbox
npm run demo
```

Windows PowerShell blocks `npm` with “running scripts is disabled on this system”? Use `npm.cmd run demo` or `node examples/offline-demo/demo.mjs` instead – same demo, no policy change needed.

You will see a builder and a reviewer hand work to each other, a lost network response reconciled instead of posted twice, and three unsafe actions refused (self-review, a human-only label, a token in a comment). Details and limits: [`examples/offline-demo`](examples/offline-demo/).

`npm run demo:handoff` shows the v0.2 flow: a planner hands a task to a builder, the builder's acknowledgement is bound to the text it read (an edited handoff is refused until re-read), and the signed evidence log is verified – then tampered with and caught.

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
| "Done" – but done *what*, against which version of the task? | **Handoffs** (v0.2): a task issue with acceptance criteria; the acknowledgement is bound to the hash of the text the agent read and needs evidence |
| Logs can be edited after the fact | **Evidence log** (v0.2): every receipt state change is hash-chained and Ed25519-signed; `evidence verify` catches edits, gaps and truncation |

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
| `handoff_create` | Hand a task to another agent: issue labelled `to:<agent>` + `handoff`, with acceptance criteria (v0.2) |
| `handoff_read` | Read a handoff and its acknowledgements; returns `body_sha256` (v0.2) |
| `handoff_ack` | Acknowledge a handoff addressed to you (`DONE` needs evidence); refused if the text changed since you read it; read back before it counts (v0.2) |

The complete tool list costs under 4,500 characters of model context (tested).

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
5. **Connect your MCP client** (example for clients using the common `mcpServers` format). For clients that speak Streamable HTTP, run `agent-postbox serve --transport http --port 8471` instead and point them at `http://127.0.0.1:8471/mcp` (other hosts need `AGENT_POSTBOX_HTTP_TOKEN`):
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

Step-by-step setup: [docs/getting-started.md](docs/getting-started.md). A walk-through with two agents reviewing each other is in [`examples/two-agent-review`](examples/two-agent-review/).

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
| `evidence` | `true` | Write the signed evidence log (v0.2); `false` disables it |
| `evidenceFile`, `evidenceKeyFile` | next to `receiptsFile` | Evidence log and its Ed25519 key (created on first use, `0600`) |
| `handoffLabel` | `handoff` | Label that marks handoff issues |

## CLI

```text
agent-postbox doctor | inbox | read <n> | comment <n> --body ... | label <n> --add a --remove b
agent-postbox propose --title ... --body-file ... | review <n> --event approve|request-changes|comment --body ...
agent-postbox handoff create --to <agent> --title ... --body ... [--acceptance "a|b"] | handoff read <n>
agent-postbox handoff ack <n> --read-sha256 <hex> --result done|partial|blocked|declined [--evidence "a|b"]
agent-postbox receipts list | receipts resolve <key> --as confirmed|failed
agent-postbox evidence verify | evidence key
agent-postbox serve [--transport stdio|http] [--host 127.0.0.1] [--port 8471]
```

All output is JSON. Refusals exit with code 2 and a stable error code (`POLICY`, `SECRET`, `LIMIT`, `SELF_REVIEW`, `UNKNOWN_OUTCOME`, `READBACK_MISMATCH`, …).

## Evidence log (v0.2)

Next to the receipts file, agent-postbox keeps `<receipts>.evidence.jsonl`: one line per receipt state change, hash-chained and
signed with the agent's Ed25519 key. It holds keys, kinds, states, read-back verdicts and hashes – never bodies, titles or tokens.
`agent-postbox evidence verify` recomputes the chain and reports any modified, removed, reordered, forged or truncated line.
The format is documented in [docs/evidence-format.md](docs/evidence-format.md) and shared with companion tools, so one verifier works for all of them.

## Known limits (v0.2)

- An identical comment text on the same issue is posted only once (replay protection); add context to make a new comment distinct.
- Duplicate-title checks and reconciliation scan up to 1,000 items. GitHub's issue lists can lag a few seconds behind writes: an agent's own duplicates are caught locally, but two different agents proposing the same title within seconds may both succeed.
- Adding a `to:<agent>` label creates that label in the repository if it does not exist yet.
- Reviews and comments are not edited or deleted by agent-postbox – by design.
- `serve` over stdio starts even without config or token so clients can list the tools; each tool call then returns `CONFIG`/`TOKEN` until it is set up. The HTTP transport refuses to start instead.
- When the MCP server and the CLI share a receipt file, a lock conflict can pause the server for up to 5 seconds, and concurrent processes may exceed a daily limit by a few writes.
- The HTTP transport is stateless JSON (no SSE, no sessions, no server-initiated messages) and has no TLS; put it behind your own reverse proxy when it leaves the machine. Browsers are kept out by design (JSON content type required, `Host` must name the server, `Origin` refused unless listed in `AGENT_POSTBOX_HTTP_ORIGINS`).
- The evidence log proves what was written to it, not what bypassed it; see `docs/evidence-format.md` "What it does not prove". Truncation at the end is detected through the signed `.head` sidecar – if the sidecar is deleted, `evidence verify` warns instead of passing cleanly.

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
