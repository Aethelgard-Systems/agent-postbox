# Example: two agents reviewing each other

Two agents – `builder` and `reviewer` – work in one test repository. A human stays in charge of decisions and merging.

## Setup (once)

1. Create a **test repository** (private is fine) and protect `main`: require a pull request and one approving review.
2. Create **two GitHub identities** (machine accounts or GitHub Apps), give both write access to the test repository, and create one fine-grained token per identity, limited to that repository with *Issues* and *Pull requests* read/write.
3. Create the labels `to:builder`, `to:reviewer`, `claimed:builder`, `claimed:reviewer`, `proposal`, `needs-review`, `approved`. GitHub also creates missing labels automatically on first use.
4. Copy `templates/AGENTS.md` and `templates/pull_request_template.md` into the repository.
5. Two config files:

```json
// builder.json
{ "repository": "you/countersign-demo", "agent": "builder", "tokenEnv": "BUILDER_TOKEN" }
```

```json
// reviewer.json
{ "repository": "you/countersign-demo", "agent": "reviewer", "tokenEnv": "REVIEWER_TOKEN" }
```

Check both, without writing anything:

```sh
BUILDER_TOKEN=... countersign doctor --config builder.json
REVIEWER_TOKEN=... countersign doctor --config reviewer.json
```

## Flow

| Step | Who | Action | countersign guarantees |
|---|---|---|---|
| 1 | Human | Opens issue #1 "Add a CONTRIBUTORS file", label `to:builder` | – |
| 2 | builder | `inbox` → sees #1; `label 1 --add claimed:builder` | may only claim for itself |
| 3 | builder | Opens PR #2 (with its own git tooling), then `label 2 --add to:reviewer,needs-review` | – |
| 4 | reviewer | `inbox` → #2; `review 2 --event request-changes --body "Criterion 2 lacks evidence"` | review bound to head commit, read back |
| 5 | builder | Pushes a fix; `comment 2 --body "DONE – evidence: …"`; `label 2 --add to:reviewer` | comment receipted, no duplicates on retry |
| 6 | reviewer | `review 2 --event approve --body "…"` | refused if reviewer were the PR author |
| 7 | builder | Tries `review 2 --event approve` | **refused: SELF_REVIEW** |
| 8 | builder | Tries `label 2 --add approved` | **refused: POLICY (human-only)** |
| 9 | Human | Merges #2 | agents have no merge endpoint |

## What to look at afterwards

- `countersign receipts list --config builder.json` – every write with state `CONFIRMED`.
- Each comment, proposal and review on GitHub carries an invisible `<!-- countersign … -->` marker used for reconciliation after network failures.
