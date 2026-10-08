# Xytha Memory Atlas

**Give every memory a traceable coordinate.**

<h2 align="center"><a href="https://xytha.com">Explore the full Xytha experience → https://xytha.com</a></h2>
<p align="center">Online conversations · Personalized memory · Chart exploration</p>

[中文](README.md) · [Scope](docs/scope.md)

![Running demonstration with synthetic data](docs/preview.png)

A standalone, dependency-free memory inspection playground. Inspect original conversations, authored summaries, six archived time layers, palace associations and append-only user corrections in one interface.

The six layers—natal, decade, year, month, day and hour—come from Xytha's exploration of a Ziwei Doushu cultural taxonomy for organizing context. **This demo does not calculate charts or establish that astrological labels predict preferences.** All people, conversations and tag mappings are synthetic; the interface currently uses Chinese labels.

## Run

Use Node.js 22 or newer, download the repository and run:

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. No install, account, API key or model call is needed. On PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

Select “查看六层示例” to load an explicit example. Change a parent time node to clear descendants, click a palace to filter records, inspect the original conversation and add a correction. Switching a profile changes the visible archive. Feedback exists only in page memory; refreshing resets it. Exporting JSON includes any feedback you typed.

## Public components

- A six-level parent/child time tree with deselection and descendant reset.
- An interactive archived-tag map and exact metadata filtering.
- Source IDs, verbatim quotations and summaries displayed side by side.
- Append-only feedback that leaves original source text and archived tags intact.
- A JSON Schema, runtime validation, synthetic fixtures and tests.

This is the **inspection layer**, not the production memory engine. Production orchestration, preference scoring, retrieval weighting, model prompts, chart computation, user data and infrastructure configuration are excluded.

## Research boundary

The repository has no user study, accuracy benchmark or measured personalization lift. It demonstrates a data model and inspectable interaction. The proposed use of palace overlays for preference retrieval is an unvalidated hypothesis. An honest evaluation needs temporal holdouts, user-confirmed relevance labels and ablations against semantic and randomized-tag baselines. See [the evaluation plan](docs/evaluation.md).

Fixture intervals are UTC, half-open intervals and deliberately simplified. Their stem-branch names are illustrative metadata, not calendrical calculations. Do not use the fixture data as chart facts.

## Develop

```sh
npm test
npm run check
npm run build
```

Deploy `dist/` to a static host, including a subdirectory. Runtime assets make no model or analytics calls. External links open only when selected. The public filter is deterministic metadata/text matching, without preference inference or ranking.

MIT licensed. The Xytha name does not imply endorsement of derivatives. Full product: [xytha.com](https://xytha.com).
