# Glama stdio container preparation

The root Dockerfile runs the dependency-free stdio server as the unprivileged `node` user on Node 24. No token/config is copied. Initialization and tool discovery work without credentials; tool calls that require a mailbox report CONFIG until the operator provides a configuration and narrowly scoped token. A successful discovery check is not proof of a successful GitHub write.

```sh
docker build -t agent-postbox:reviewed .
docker run --rm -i agent-postbox:reviewed
```

For actual operation, mount a configuration read-only, set `AGENT_POSTBOX_CONFIG` to its container path, supply `AGENT_POSTBOX_TOKEN` through the operator's secret mechanism, and persist `/home/node/.local/state` with permissions for the `node` user. Do not include token values in the Dockerfile, build arguments, public listing or command examples.

## Maintainer steps (no automatic publication)

1. Open https://glama.ai/mcp/servers/Aethelgard-Systems/agent-postbox/admin/dockerfile.
2. Select the reviewed root Dockerfile and exact source commit.
3. Leave credentials absent for the initialize/tools-list build test.
4. After approval for that external build test, use Deploy and inspect the discovered tools and build log.
5. Use the Score tab's actual findings to improve descriptions and constraints: purpose, when to call, side effects/idempotency, parameter meaning, concise wording and context completeness.
6. Record the new scan's actual score and time; no fixed score increase is promised.
7. Leave Make Release / Create & Publish Release to Marco under the existing publication approval.
8. Add a badge only when Marco supplies its exact snippet from the listing tab; no placeholder is included here.

Complete maintainer verification if missing. A working container enables Glama's build/introspection checks; a committed Dockerfile alone does not prove discovery, a security rating or a release. The previously reported 33% discovery score remains INTERNAL_REPORTED, not a fresh measurement. Tool-definition score, discovery and release state are separate signals.

Local evidence 2026-11-04: Docker daemon socket access denied in WORK's sandbox. Docker build/runtime **not tested**. Existing source-level tests do not replace that check.

Sources checked 2026-11-04: [Glama release steps](https://glama.ai/blog/2026-03-15-how-to-make-a-release), [indexing and quality methodology](https://glama.ai/mcp/methodology).
