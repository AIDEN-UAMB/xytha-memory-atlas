# Xytha Nous 1.0

**A runnable first-generation domain-agent engine: plan, compute, ground, check, remember.**

[中文](README.md) · [Live Xytha](https://xytha.com) · [Source provenance](SOURCE-MANIFEST.json)

This release includes the complete Nous execution dependency graph, original chat endpoint, deterministic Ziwei chart engine integration, time-range analysis, provider adapters, evidence contracts, memory extraction/retrieval, leases and checkpoint recovery. A new loopback-only browser workspace makes the snapshot independently runnable. Henosis and production infrastructure remain outside this release.

## Run

Node.js 24 LTS is required.

```sh
cd nous-1.0
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4174**. Without a key, responses show deterministic chart facts and rule-based boundaries. To use a model, copy `.env.example` to `.env`, enter your own `NOUS_API_KEY`, `NOUS_MODEL`, endpoint and protocol, then restart. Provider charges apply. Necessary personal context is sent to that provider. No unrelated machine-wide provider credentials are loaded.

Create a local profile, ask a question, inspect the chart, and revisit history. The supplied person is synthetic. To generate queued structured memories, run `npm run memory:process`; each invocation handles at most one job per profile and may incur provider charges.

## What 1.0 actually does

- Bounded, adaptive single-orchestrator workflow; not an autonomous multi-agent swarm.
- Shared task evidence, conditional semantic planning and source-bound chart computation.
- Deterministic contract checks and optional model review. `XYTHA_DIRECT_OUTPUT=true` bypasses that contract branch and must not be described as verified.
- SSE progress events; answer chunks are emitted **after the complete answer has been generated**. Incremental answer generation is a future design, not a shipped claim.
- The analysis engine exposes natal, decade, year, month and day scopes. The separate Atlas hour-tag demo does not establish hour-level analysis support in Nous.
- No demonstrated predictive validity for astrological labels. User statements, software-computed chart facts and traditional interpretations are distinct.
- Local single-user persistence is not a public authentication service. Conversation SQLite is not full-disk encrypted; the vault protects selected secrets/checkpoint/memory payloads. Protect the entire local state directory with your OS permissions.

## Verify

```sh
npm run typecheck
npm test
npm run check
```

Tests use synthetic fixtures and mock providers, not paid-model benchmarks. See [testing](docs/testing.md) and [version boundaries](docs/version-boundary.md). Copied file hashes and the history compatibility adaptation are documented in `SOURCE-MANIFEST.json`. No private repository history, credentials, real user records or private operational logs are included.

MIT for the published original code; third-party packages retain their own licenses. Xytha branding does not imply endorsement of derivatives. Nous 2.0 is not implemented in this release.
