# Live test against real GitHub – 2026-10-26

Evidence that agent-postbox v0.2.0 works with real identities against the real GitHub API (until now only covered by the fake GitHub in the unit tests and by `scripts/live-test.mjs` in CI).

| Item | Value |
|---|---|
| Version | `main@0a96809` (`package.json` 0.2.0), run from a fresh clone with `node src/cli.js` (same code as `npm install -g github:…`) |
| Runtime | Node.js v22.23.4, Linux (WSL2) |
| Client | CLI for every step; MCP server (`serve`, stdio) smoke-tested with `initialize` → `tools/list` → `inbox` |
| Offline tests before the run | `npm test`: 49/49 pass |
| Test repository | new public sandbox repository owned by identity A, only an initial README on `main`, synthetic content only |
| Identity A (`planner`) | repository owner, fine-grained token limited to the sandbox repository |
| Identity B (`builder`) | separate machine account, collaborator with *Write*, classic token (`public_repo`) → config sets `allowClassicToken: true` |
| Token handling | tokens only in environment variables referenced by `tokenEnv`; never in configs, logs or this file. Account names are replaced by A/B. |
| Operator | Claude Code (HELP_DESK_LOKAL) driving both identities from one shell |

## Results

Durations are wall-clock per CLI call (process start included). `rc=2` is the documented exit code for refusals.

### Setup

| Step | Command | Result | Duration |
|---|---|---|---|
| doctor A | `doctor` | OK; `token-type` OK, **WARN** `token owner has admin on the repository; prefer a dedicated agent identity without admin` | 825 ms |
| doctor B | `doctor` | OK; **WARN** `classic token with scopes: public_repo`, no admin | 715 ms |
| MCP smoke test | `serve` (stdio) as A | `serverInfo` agent-postbox 0.2.0; 9 tools: `inbox, read, comment, label, propose, review, handoff_create, handoff_read, handoff_ack`; `inbox` returns `[]` | 567 ms (whole session) |

### Step 4 – flow

| # | Who | Action | Result | Duration |
|---|---|---|---|---|
| 4a | A | `handoff create --to builder` with 2 acceptance criteria | `CONFIRMED`, issue #1, `body_sha256=6945216e…5735` | 2403 ms |
| 4b | B | `inbox` immediately after | `items: []` (list lag, see Notes) | 482 ms |
| 4b | B | `handoff read 1` | `handoff: true`, `body_sha256=6945216e…5735` – identical to A's | 391 ms |
| 4b | B | `inbox` again on the next call | issue #1 listed, labels `to:builder, handoff` | 499 ms |
| 4c | B | `label 1 --add claimed:builder` | `CONFIRMED` | 2169 ms |
| 4c | B | deliver: branch + `echttest/hallo.md` + PR via raw API (scaffolding, the tool cannot push by design) | PR #2 created (HTTP 201) | 3682 ms |
| 4d | B | `handoff ack 1 --read-sha256 6945216e… --result done --evidence "PR #2 …\|…"` | `CONFIRMED`, `read_sha256` bound to the text B read | 2248 ms |
| 4e | A | `handoff read 1` | `acknowledged: true`, one ack by B, `result: DONE`, same `read_sha256` | 441 ms |
| 4f | A | `review 2 --event comment` | `CONFIRMED`, `state: COMMENTED`, bound to head commit `2bfff7b` | 2802 ms |
| 4g | A | `evidence verify` | `{"ok": true, "problems": [], "warnings": [], "entries": 6}` | 60 ms |
| 4g | B | `evidence verify` | `{"ok": true, "problems": [], "warnings": [], "entries": 6}` | 54 ms |

**Not done: `review --event approve` by A.** The operator's own safety layer (Claude Code auto mode) refused it as self-approval, because one operator controlled both the author (B) and the reviewer (A). The four-eyes path in agent-postbox is the same for `COMMENT` and `APPROVE` (any review on an own PR is refused, see 5a); an `APPROVE` against the real API is still covered by `scripts/live-test.mjs` in CI. A human can add it: `agent-postbox review 2 --event approve …` with identity A.

### Step 5 – counter-checks

| # | Who | Action | Expected | Result | Duration |
|---|---|---|---|---|---|
| 5a | B | `review 2` on its own PR | refused | `rc=2` `SELF_REVIEW`: `four-eyes rule: <B> opened this pull request and cannot review it` | 810 ms |
| 5b | A | `handoff create` (issue #3) | – | `CONFIRMED`, `body_sha256=46997c30…` | 1757 ms |
| 5b | B | `handoff read 3` | – | `body_sha256=46997c30…` | 435 ms |
| 5b | A | edits issue #3 body (raw API `PATCH`) | – | HTTP 200 | 1451 ms |
| 5b | B | `handoff ack 3` with the old hash | refused | `rc=2` `READBACK_MISMATCH`: `the handoff changed since you read it; call handoff_read again and acknowledge what is there now`, details `body_sha256=555e4590…` | 475 ms |
| 5b | B | re-read, ack with new hash `555e4590…` | accepted | `CONFIRMED` | 429 + 2002 ms |
| 5c | A | `handoff ack 3` (addressed to B) | refused | `rc=2` `POLICY`: `this handoff is not addressed to planner` | 560 ms |

### Step 6 – load and notable messages

- Reads (`inbox`, `read`, `handoff read`) took 0.4–0.5 s, refusals 0.5–0.8 s, confirmed writes 1.8–2.8 s (write + read-back). `evidence verify` is local (≈ 60 ms).
- Total for 19 calls: ≈ 23 s, no retries, no `UNKNOWN_OUTCOME`, no rate-limit responses.
- Notable messages, verbatim:
  - `token owner has admin on the repository; prefer a dedicated agent identity without admin` (A, as expected for the repository owner)
  - `classic token with scopes: public_repo` (B; classic tokens need `allowClassicToken`)
  - Inbox right after `handoff create` was empty – matches the documented list lag ("GitHub's issue lists can lag a few seconds behind writes"); `handoff read` by number worked immediately.

## Notes

- Sandbox state after the run: issues #1 and #3 and PR #2 left open as public evidence; nothing merged.
- Receipts, evidence logs and keys stayed outside the repository in a private state directory (`0700`, files `0600`); a scan of that directory for token patterns found none.
- The run used two identities but one operator. It shows that the tool enforces its rules against the real API; it does not show two independent agents.
