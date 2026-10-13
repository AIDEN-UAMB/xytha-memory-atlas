# Third-party components

Xytha's published original source is MIT-licensed. Dependencies are installed from the pinned lockfile; their copyright notices and licenses remain applicable and are not replaced by the repository license.

Runtime dependencies include iztro (deterministic Ziwei chart calculations), zod (schema validation), and undici (HTTP dispatch / egress guard). Build and verification use esbuild, TypeScript and Node type declarations. See each installed package's LICENSE and package metadata, plus the transitive packages listed in `package-lock.json`.

Node.js provides the runtime, HTTP server, cryptography and SQLite binding. No third-party model weights, API credentials, private datasets or vendor service rights are distributed. Users supply their own provider accounts and comply with those providers' terms.

The Xytha mark is reused from this repository's existing brand asset. Use of the name or mark must not suggest an unofficial derivative is the official Xytha service.
