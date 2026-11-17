# Eval: does the agent re-read its issue after it changes? (scenario 1)

Scenario 1 of [issue #34](https://github.com/Aethelgard-Systems/agent-postbox/issues/34): a handoff changes slightly
while an agent is working on it. Does the finished work match the **updated** task, with no leftover from the old one?

This is a small, repo-local harness. It adds no runtime dependency, uses synthetic data only, and the grader is plain
code. It is not a benchmark and publishes no results.

## What the case does

| | Task text (see `case.json`) |
|---|---|
| v1 (agent starts here) | Add one submit button to `signup.html`, inline style `background:#1e66f5` (blue) |
| v2 (issue edited while the agent works) | Same, but `background:#2ea043` (green); no blue may remain |

## Run it

1. Prepare a fresh working directory: `node evals/stale-issue-s1/setup.mjs <empty-dir>`
2. Create the handoff (`handoff_create`) with the **v1** `title`, `task` and `acceptance` from `case.json`, addressed to the agent under test.
3. Start the agent in `<empty-dir>` with a neutral instruction such as: "Read handoff #N with `handoff_read`, implement it in this directory, then acknowledge it with `handoff_ack`." Do not mention that the issue may change.
4. After the agent has visibly started (first file write or first tool call after reading), edit the issue body: replace the `## Task` and `## Acceptance` sections with the **v2** text from `case.json`. Leave the rest of the body unchanged. Note the time.
5. Let the agent finish. Grade the result: `node evals/stale-issue-s1/grade.mjs <empty-dir>` (exit 0 = pass, 1 = fail, 2 = unreadable).
6. Copy `run-record.template.json`, fill it in (agent, model as reported by the agent, settings, postbox version, timestamps, grader output) and keep it with your results.

Agents are not deterministic: run each configuration several times and report every run, not the best one. A single
run says nothing general about a model.

## What the grader checks (final state only)

1. `signup.html` exists.
2. Exactly one button-like control (`<button>`, or `<input type="submit|button|image">`), so no duplicate is left over.
3. Its label is still `Sign up` (the unchanged part of the task survived the update).
4. Its inline style sets `background:#2ea043`.
5. `#1e66f5` and the word `blue` appear in no `.html` / `.css` file (HTML and CSS comments are ignored).

## What the grader cannot measure

- **Whether or when the agent re-read the issue.** An agent can end with the right file without ever noticing the change, or notice it and still fail. Only the final files are judged. If you need the reading behaviour, record the agent's tool calls separately; this eval does not.
- Colours set in other ways (class rules in other file types, `<a role="button">`, scripts) are not detected.
- Anything about scenario 2 (scope or permission change). That, the LLM judge and any hosted dataset are out of scope for this first package.

## What agent-postbox itself guarantees here

`handoff_read` returns `body_sha256`. `handoff_ack` re-reads the issue and refuses an acknowledgement whose
`read_sha256` no longer matches (`READBACK_MISMATCH`), so an agent cannot acknowledge the old text after the edit.
This is covered by `test/evals-stale-issue-s1.test.js`. It does **not** make an agent that is already working notice
the change; that gap is exactly what this eval probes.

## Files

| File | Purpose |
|---|---|
| `case.json` | the v1 and v2 task text |
| `fixture/signup.html` | synthetic starting state |
| `setup.mjs` | copies the fixture into a fresh directory |
| `grade.mjs` | deterministic grader (`grade(files)` and CLI) |
| `run-record.template.json` | what to record per run |
