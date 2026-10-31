---
id: task005
title: Publish v0.1 to npm
status: blocked
paths:
  - packages/
  - runtimes/
  - create-longhorn/package.json
  - cli/package.json
  - cli/LICENSE
  - create-longhorn/LICENSE
  - scripts/verify-otlp.mjs
  - scripts/verify-otlp-metrics.mjs
  - scripts/verify-npm-rehearsal.mjs
  - docs/releasing.md
  - docs/otlp-json.md
  - CHANGELOG.md
shared:
  - package.json
  - .github/workflows/verify.yml
  - docs/features.md
depends:
  - task003
  - task004
---

## Goal

`npm create longhorn@latest` works for someone without a checkout. Until then, every
quickstart begins with cloning this repository, which most developers will not do.

## Owner direction

None yet. Publishing is the owner's decision and hard to undo.

## Read first

- [Project generation](../docs/project-generation.md)
- [Upgrades](../docs/command-app-upgrades.md)

## Scope

- Package metadata: `license`, `repository`, `description` are absent on every package,
  and versions are a mix of 0.0.0 and 0.0.1.
- Secure an npm scope. `longhorn` proved to be taken on 1 November 2026, so the scope became
  `@longhornjs`. On 31 October 2026 `@longhorn/core`,
  `create-longhorn` and `longhorn` returned 404 from the registry, which does not prove
  the scope is free.
- Release tooling and a changelog.
- A CI gate that installs from the published tarballs.

## Acceptance checks

On a clean machine, `npm create longhorn@latest my-api` creates an app that starts.

## Evidence

1 November 2026, macOS ARM64, Node 20.19.4, nothing sent to npm.

- Every public package now has version 0.1.0, a license, description, repository and public access. The observability scope version in exported telemetry moved with it.
- `pnpm build`, `pnpm typecheck` clean. `pnpm test` 749 of 749 in 119 files. `pnpm test:tasks`, `verify-otlp`, `verify-otlp-metrics` and `verify-sqlite-project` exit 0.
- `verify-npm-rehearsal` exit 0: 23 tarballs checked, then installed in an empty folder. A generated Node project built, started and returned `{"status":"ok","runtime":"node","ready":true}` from outside this repository.
- The gate first failed on six `.env.example` templates. They hold default settings only and are meant to ship, so the rule now allows exactly that name. Its file and secret patterns were checked against good and bad samples.

Blocked on the owner: the `@longhornjs` npm organization, an npm login and the release itself. See [releasing](../docs/releasing.md). The acceptance check, `npm create longhorn@latest` on a clean machine, can only run after that. Only the Node template was rehearsed.
