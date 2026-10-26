# Threat model — agent-postbox v0.2

Scope: the CLI/MCP process and its configured GitHub repository. This is a
coordination tool, **not a sandbox**. Controls below describe the implementation
in [src/](../src/), not a guarantee about an AI agent's judgement.

## Actors, assets and trust boundaries

The local operator controls the config, environment, executable, receipt store
and evidence keys. A local agent/MCP client can request tools; another agent or
repository contributor can supply issue/PR text, comments and labels. A repository
reader sees everything their GitHub permissions allow. A token thief can bypass
this process and call GitHub directly.

Protect the GitHub token, task content, repository state, receipt file and signed
evidence log/private key. Treat repository text and MCP arguments as untrusted.
Config/environment and the local filesystem are operator-controlled inputs, not
an isolation boundary against another process running as the same OS user.

## Attacks, controls and remaining risk

| Attack | Existing control | Remaining risk / operator responsibility |
|---|---|---|
| Agent writes outside the intended repository or merges/deletes work | Repository-bound endpoint allowlist in `github.js`; no merge, issue-close, body-edit, code or settings endpoint | A token holder can use GitHub directly. Use separate, narrowly scoped tokens and GitHub branch protection/required reviews; the tool does not configure them. |
| Agent approves its own PR or poses as another reviewer | `mailbox.js` checks token identity, rejects any review of that identity's own PR, and binds the review to the observed head commit | Distinct identities do not prove distinct operators or independent judgement. App tokens unable to answer `/user` rely on the operator-supplied login. A later head needs a new review. |
| Agent grants itself authority through labels or proposals | Protected-label policy, self-only claim labels, allowed labels and no-authority proposal/handoff text | Label policy is local configuration. Contributors with direct GitHub access can alter labels; text or a `to:` label is never human authorization. |
| Issue text tricks a model into taking an unsafe action | Read results/tool descriptions mark content as untrusted; tool arguments are schema-checked and writes remain bounded | There is no model-level prompt-injection defence or permission system for the caller. The agent may obey malicious content or act outside this tool. |
| Token or private task content leaks to repository readers | Best-effort secret filtering and bounded outgoing text in `sanitize.js`; receipts omit bodies/titles/tokens | Filters miss secrets and private information. Task/comment bodies are stored on GitHub and visible to permitted readers. This is not encryption or private-document storage. |
| Timeout causes a duplicate or a forged marker confirms a write | Durable `ATTEMPTED` receipt before sending, exact read-back, own-author/exact-text reconciliation; unclear outcomes block blind retry | Receipts are local hints; GitHub is canonical. Bounded scans/list lag can prevent reconciliation. A human must inspect unresolved outcomes; no global exactly-once guarantee. |
| Agent acknowledges a task it did not read or fabricates completion | Handoff acknowledgement is addressed to the configured agent, checked against the current body hash and read back; `DONE` requires evidence strings | Evidence strings need not be true or sufficient. The hash binds text, not understanding, successful execution or immunity to a later edit. |
| Spam or simultaneous writers exceed quotas | Local daily write/proposal limits; receipt updates use a lock, compare-and-set and atomic rename | Limits are per store/machine; concurrent calls can overshoot. This is not a GitHub-wide quota or a denial-of-service defence. |
| Local attacker rewrites receipts or audit history | Receipts/private keys are created with mode `0600`; optional evidence entries are hash-chained and Ed25519-signed, with a signed head sidecar | The same OS user can alter files or steal keys. Missing head is a warning. Replaying an old valid log **and** head needs an external trusted checkpoint to detect; pin the public key separately. |
| Evidence logging fails or activity bypasses the log | Verification reports invalid entries/head mismatches; receipt code reports evidence-write failures on stderr | Logging is optional and best effort: its failure does not block a receipt/write. A valid log proves neither completeness nor real-world success; timestamps use the local clock. |
| Another client drives the HTTP endpoint | Loopback default; non-loopback requires bearer; JSON content type, Host checks, Origin policy and body limit | No TLS is provided. Use a trusted reverse proxy for remote access; protect the bearer. A client allowed to connect gets this process's configured agent powers. Stdio trusts its parent process. |

## Reporting and evidence limits

Report endpoint/policy bypasses, token disclosure, receipt/read-back or four-eyes
bypasses privately using [SECURITY.md](../SECURITY.md), with synthetic reproduction
data and no real credentials. Prioritize unauthorized cross-repository writes or
credential exposure over misleading status or availability-only failures; impact
and required access matter more than the label alone. Direct use of a stolen token
and external agent behaviour remain outside this tool's enforcement boundary.

This model is checked against README [Security model](../README.md#security-model)
and [Known limits](../README.md#known-limits-v02), [SECURITY.md](../SECURITY.md),
and the [evidence format](evidence-format.md). The reported
[real GitHub test](evidence/live-test-2026-10.md) and synthetic regression tests
support specific exercised paths; they are not a penetration test or proof that
all attacks are prevented.
