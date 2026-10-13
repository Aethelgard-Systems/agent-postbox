# Getting started

This guide takes you from zero to two AI agents that hand work to each other and review each other's pull requests through one GitHub repository. Plan about 30 minutes.

## What you need

| Need | Why |
|---|---|
| Node.js 20 or newer | agent-postbox has no other runtime dependency |
| A GitHub repository | The shared mailbox. Private is fine. |
| **One GitHub identity per agent** | Authorship, four-eyes review and per-agent permissions only work if agents do not share a token |
| An MCP client (Claude Desktop, Claude Code, Cursor, LibreChat, …) or a shell | To let the agent call the tools |

## 1. Prepare the repository

1. Protect `main`: *Settings → Branches → Add rule* → require a pull request and one approval. Merging stays human.
2. Copy [`templates/AGENTS.md`](../templates/AGENTS.md) and [`templates/pull_request_template.md`](../templates/pull_request_template.md) (as `.github/pull_request_template.md`) into the repository.
3. Labels are created automatically on first use. You may pre-create `to:<agent>`, `claimed:<agent>`, `proposal`, `needs-review`, `blocked`, `question`, `approved` for nicer colours.

## 2. Give each agent its own identity

Pick one option per agent.

### Option A – machine account + fine-grained token (simplest)

1. Create a separate GitHub account for the agent and invite it to the repository with *Write* access.
2. As that account: *Settings → Developer settings → Fine-grained tokens → Generate*.
   - Repository access: **only** your mailbox repository
   - Permissions: *Issues* read/write, *Pull requests* read/write, *Metadata* read
3. Store the token where your MCP client can pass it as an environment variable. Never commit it.

### Option B – GitHub App (no extra account, short-lived tokens)

1. *Organization or user settings → Developer settings → GitHub Apps → New GitHub App*.
   - Webhook: **inactive**. No callback URL, no OAuth, no device flow.
   - Repository permissions: *Issues* read/write, *Pull requests* read/write (*Contents* only if the agent must push code).
   - Installable: only on this account.
2. Note the **App ID**, generate a **private key**, and **install** the app on the mailbox repository only.
3. Installation tokens expire after one hour. Mint one with your tooling (for example [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) in CI) and set `"login": "<app-slug>[bot]"` in the config, because app tokens cannot call `GET /user`.

Classic personal access tokens (`ghp_…`) are refused unless you set `allowClassicToken`.

## 3. Install and configure

```sh
npm install -g github:Aethelgard-Systems/agent-postbox
```

One config file per agent, for example `builder.json`:

```json
{
  "repository": "your-org/your-repo",
  "agent": "builder",
  "tokenEnv": "BUILDER_TOKEN"
}
```

Check without writing anything:

```sh
BUILDER_TOKEN=... agent-postbox doctor --config builder.json
```

`doctor` reports the token type, whether the identity has admin rights (it should not), who you act as, and where receipts are stored.

## 4. Connect your agent

MCP clients that use the common `mcpServers` format:

```json
{
  "mcpServers": {
    "postbox": {
      "command": "agent-postbox",
      "args": ["serve", "--config", "/path/to/builder.json"],
      "env": { "BUILDER_TOKEN": "<builder token>" }
    }
  }
}
```

The agent now has six tools: `inbox`, `read`, `comment`, `label`, `propose`, `review`. Tell it to read `AGENTS.md` first.

## 5. A first round trip

| You / agent | Action |
|---|---|
| You | Open an issue and add the label `to:builder` |
| builder | `inbox` → finds it, `label` → `claimed:builder`, does the work, opens a PR, `label` → `to:reviewer` |
| reviewer | `inbox` → finds the PR, `review` → `REQUEST_CHANGES` or `APPROVE` |
| builder | `comment` with evidence (DONE / PAUSED / BLOCKED) |
| You | Merge |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `TOKEN: classic personal access token detected` | `ghp_` token | Use a fine-grained token or an app token |
| `TOKEN: cannot determine the token owner` | App token without `login` | Set `"login": "<app-slug>[bot]"` |
| `SELF_REVIEW` | The agent opened the PR it tries to review | Use the other agent; this is the four-eyes rule working |
| `POLICY: label … is protected` | Human-only label | A human sets it |
| `UNKNOWN_OUTCOME` | A previous identical write did not confirm | Check GitHub, then `agent-postbox receipts resolve <key> --as confirmed\|failed` |
| An item is missing from `inbox` right after it was labelled | GitHub's lists lag a few seconds | Retry shortly |
| GitHub Actions: "Installation not found" | App created but not installed | Install the app on the repository |
| GitHub Actions secrets empty for a private repo | Organization secrets are not available to private repos on the free plan | Use repository secrets |
