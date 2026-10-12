# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting for this repository (*Security* tab → *Report a vulnerability*). You will receive an acknowledgement as soon as the maintainer is able to review it. This is a volunteer-maintained project without a guaranteed response time.

Never include real tokens or credentials in a report. Synthetic examples are enough.

## In scope

- Any way to make countersign perform a write outside its endpoint allowlist or outside the configured repository
- Bypassing the four-eyes check, label policy, daily limits or receipts
- Token disclosure through output, errors or the receipt file
- Prompt-injection paths where content read by countersign is executed as a tool action *by countersign itself*

## Out of scope

- Actions taken by someone holding the token directly against the GitHub API
- Secrets the best-effort filter does not recognise (please still tell us about common formats we miss)
- Behaviour of the AI agent or MCP client using countersign
