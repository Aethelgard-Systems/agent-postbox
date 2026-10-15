# Evidence log format v1

A small, implementation-independent format for **tamper-evident action logs**: append-only JSON Lines, each entry
hash-chained to its predecessor and signed with Ed25519. agent-postbox writes it for every receipt state change
(`<receipts>.evidence.jsonl`); companion tools in the same family (e.g. a gate that confirms tool calls) write the
same format, so one verifier can check logs from different sources. Reference implementations: `src/evidence.js`
(JavaScript, zero dependencies) and an equivalent in Python – both verify each other's logs.

## Entry

One JSON object per line. Keys, all required (empty string when not applicable):

| Field | Type | Meaning |
|---|---|---|
| `seq` | integer | 1, 2, 3 … without gaps |
| `ts` | number | Unix time in seconds, ≤ 3 decimals |
| `event` | string | What happened: in agent-postbox the receipt state (`ATTEMPTED`, `CONFIRMED`, `FAILED`, `UNVERIFIED`, `RESOLVED`); a gate uses `preview`, `decision`, `result`, `readback`, `allow` |
| `call_id` | string | Correlates entries of one action (receipt key, call id) |
| `tool` | string | The tool or write kind (`comment`, `handoff-ack`, `ueberweisung` …) |
| `args_sha256` | string | SHA-256 of the canonical arguments, never the arguments themselves |
| `summary` | string ≤ 500 | Human-readable one-liner. Keep secrets and private data out of it |
| `decision` | string | `allow`, `confirm`, `deny`, `approve`, or the state |
| `by` | string | Who decided / acted: an agent name, `human`, `web`, `elicitation`, `timeout`, `policy`, `rule:…` |
| `result_sha256` | string | SHA-256 of the canonical result, if any |
| `readback` | string | Verdict of the read-back: `ok`, `unclear`, `failed`, `none` (localized aliases such as `unklar`/`fehlgeschlagen` may appear; verifiers do not interpret values) |
| `note` | string ≤ 500 | Free text (reason, error class) |
| `prev` | string | `hash` of the previous entry; `"0" × 64` for the first |
| `hash` | string | SHA-256 (hex) over the canonical JSON of the thirteen fields above |
| `sig` | string | Ed25519 signature (hex) over the raw 32 bytes of `hash` |

A sidecar file `<log>.head` contains the latest `hash`, so truncation at the end is detectable while the sidecar is intact.

## Canonical JSON

For hashing, serialize the thirteen fields with **keys sorted**, **no whitespace**, non-ASCII characters kept as-is
(UTF-8), integers without decimal point, floats in shortest round-trip form. This is Python's
`json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` and the `canonical()` function in `src/evidence.js`.
The line as written to the file is the canonical JSON of the full entry (fifteen keys, sorted).

## Verification

For each line in order: (1) all fifteen keys present and no others; (2) `hash` equals SHA-256 of the canonical
thirteen fields; (3) `sig` verifies against the public key; (4) `prev` equals the previous entry's `hash` (genesis for the
first); (5) `seq` increments by one. Finally the head sidecar, if present, must equal the last `hash`. A verifier
reports every failing line with its number; any of **modified, removed, reordered, inserted, forged or truncated** is detected.

```sh
agent-postbox evidence verify      # this agent's log
agent-postbox evidence key         # its public key (PEM) – share it with whoever should be able to verify
```

## What it does not prove

- Entries that were never written (a bypassed tool, a second unlogged process). Deploy so that the logged path is the only path.
- Who holds the private key: the signature proves *the key* signed, not that the agent's operator did. Keep the key file
  (`0600`) with the agent and publish only the `.pub`.
- Time: `ts` is the writer's clock. For stronger ordering across machines, anchor the head hash somewhere external
  (a commit, a ticket comment, a timestamping service).

## Keys

Ed25519, PKCS#8 PEM for the private key (created with mode `0600` on first use), SPKI PEM for the public key
(`<key>.pub`). Rotating a key starts a new log file; old logs stay verifiable with the old public key.
