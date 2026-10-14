# Offline demo

```sh
npm run demo
```

Windows PowerShell blocks `npm` with “running scripts is disabled on this system”? Use `npm.cmd run demo` or `node examples/offline-demo/demo.mjs` instead – same demo, no policy change needed.

For screen recordings: `npm run demo:slow` pauses between steps.

Requires Node.js ≥ 20, nothing else: no install, no GitHub account, no token, no network.

## What it shows

| Step | What happens | Guarantee |
|---|---|---|
| 1–3 | A human assigns issue #1 to `builder`; builder claims it and hands PR #2 to `reviewer` | Agents address each other with `to:` labels; claims only for themselves |
| 4 | `reviewer` requests changes | Review bound to the PR's head commit, read back |
| 5–6 | `builder` reports evidence, the network drops right after the write, builder retries | **Unknown outcome is detected; the retry finds its own write instead of posting a duplicate** |
| 7 | `reviewer` approves the new head commit | Four-eyes with separate identities |
| 8 | `builder` tries to approve its own PR | Refused: `SELF_REVIEW` |
| 9 | `builder` tries to set `approved` | Refused: `POLICY` (human-only label) |
| 10 | `builder` tries to post a token | Refused: `SECRET`, nothing written |
| 11 | The human merges | Agents have no merge endpoint |

The run ends with a summary such as `5/5 writes CONFIRMED by read-back, 0 duplicates, 3 unsafe actions refused.`

## Limits – what this demo does not prove

- GitHub is simulated in memory (`test/fake-github.js`). The demo shows agent-postbox's own logic, not GitHub's behaviour, rate limits or permissions.
- Opening the pull request is simulated; in real use agents push code with their own git tooling.
- Receipts are written to a temporary directory and deleted afterwards.

To run the same flow on a real test repository with two GitHub identities, see [`../two-agent-review`](../two-agent-review/). The demo is part of the test suite (`test/demo.test.js`), so it stays runnable.
