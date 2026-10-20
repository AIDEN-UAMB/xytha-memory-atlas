# Xytha Henosis 1.0

**Plan. Investigate. Compare. Synthesize.**

[Try Xytha](https://xytha.com) · [中文说明](README.md) · [Architecture](docs/architecture.md)

This is the original `xytha-henosis.1` / `henosis-depth.10` execution core and its runtime dependencies, packaged for standalone Node.js use. It is an orchestration system, not a foundation model. Henosis-2.0 remains separate and is not published here.

## Quick start

Node.js 22.13 or newer:

```sh
git clone https://github.com/AIDEN-UAMB/xytha-memory-atlas.git
cd xytha-memory-atlas/henosis-1.0
npm ci
npm run build
npm run demo
npm test
npm run check
```

The demo computes a synthetic chart without model calls. Regression tests exercise planning, evidence collection, context pressure, repair, recovery and delivery using offline fixtures, not expert-approved interpretation labels.

For real model use, copy `.env.example` to `.env`, supply your provider credentials, copy `examples/input.json` into `private-inputs/input.json`, edit the authorized input, then run:

```sh
npm start -- private-inputs/input.json
```

Supported protocols: OpenAI-compatible Chat Completions, Responses, Anthropic Messages and Gemini. Actual model availability and structured-output compatibility depend on your provider. Necessary question/chart data is transmitted to that provider and incurs its charges.

The CLI returns a completed answer, or exits with code 2 for limited delivery. Code 1 means input or execution failure. Checkpoints are in-memory in this example; inject persistent, tenant-scoped `load/save` ports to retain progress across process restarts.

## What's preserved

Original planning, evidence, prompts, bounded refinement, partitioning, draft validation and recovery code. The [source manifest](SOURCE-MANIFEST.json) identifies original files and standalone host adapters. Website authentication, production databases, deployment material and private records are excluded.

The original analysis supports natal, decadal, annual, monthly and daily scopes. It reports stage progress rather than streaming answer tokens. Original resource ceilings remain: 32 model calls, a 30-minute soft deadline and 300,000 tokens. These are ceilings, not expected per-request costs.

Passing synthetic engineering tests does not establish predictive validity, expert-level quality or superiority over other systems. Traditional interpretation must remain distinct from observed real-world facts.

MIT licensed; see [third-party notices](THIRD-PARTY-NOTICES.md).
