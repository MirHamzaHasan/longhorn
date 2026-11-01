---
id: task020
title: Make the project discoverable with package keywords, the site homepage and llms.txt
status: done
paths:
  - packages/auth/package.json
  - packages/cache/package.json
  - packages/config/package.json
  - packages/container/package.json
  - packages/core/package.json
  - packages/database/package.json
  - packages/events/package.json
  - packages/http/package.json
  - packages/idempotency/package.json
  - packages/logger/package.json
  - packages/observability/package.json
  - packages/outbox/package.json
  - packages/queue/package.json
  - packages/ratelimit/package.json
  - packages/runtime/package.json
  - packages/scheduler/package.json
  - packages/validation/package.json
  - runtimes/bun/package.json
  - runtimes/deno/package.json
  - runtimes/node/package.json
  - runtimes/workers/package.json
  - cli/package.json
  - create-longhorn/package.json
  - llms.txt
shared:
depends:
---

## Goal

People and AI agents can tell what LongHorn is from the repository and from npm metadata, without any claim the project can't back.

## Owner direction

Marketing and AEO brief from the owner, 1 November 2026: "README with the same hero pitch, badges, quickstart, alpha notice, site link" and "package.json for every package: description, keywords, homepage, repository, bugs, license". Also: "do best AEO so other agents can see what this project is about".

## Read first

- [README.md](../README.md)
- [docs/supported-runtimes.md](../docs/supported-runtimes.md)

## Scope

- Add `keywords` to every published package.
- Point every published package's `homepage` at https://longhorn.run/, the live site.
- Add `llms.txt` at the repository root, linking to repository files and the live site.

The README pitch and alpha notice moved to task030 (#70), which owns `README.md`.

## Out of scope

- Publishing to npm. These fields reach npm with the next release, which the owner publishes.
- Changing any package's code, exports or version.

## Acceptance checks

`pnpm task check` lists nothing outside this claim, and every changed `package.json` parses.

## Evidence

1 November 2026, macOS ARM64: `pnpm task check` passed. All 23 published packages parse, have keywords and the new homepage, and stay at 0.1.0. A diff filter found no `package.json` change other than these two fields. Every repository file `llms.txt` links to exists, and https://longhorn.run/ and its `llms-full.txt` returned 200. Nothing was built or run locally, because no code changed; hosted CI is the check on this pull request.
