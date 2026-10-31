---
id: task018
title: Rename the npm scope to @longhornjs
status: done
paths:
  - packages/
  - runtimes/
  - examples/
  - starters/
  - cli/
  - create-longhorn/
  - scripts/
  - docs/
  - site/
  - tasks/
  - native/
  - .github/
  - README.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - vitest.config.ts
  - AGENTS.md
  - CONTRIBUTING.md
  - CHANGELOG.md
  - SECURITY.md
  - tsconfig.base.json
  - tsconfig.json
shared:
depends:
---

## Goal

Every public scoped package is named `@longhornjs/*`, so it can be published. The project and `create-longhorn` keep their names.

## Owner direction

1 November 2026: "it say longhorn not available", while creating the npm organization. Earlier: "do what ever is good bro just do it".

## Read first

- [Releasing](../docs/releasing.md)

## Scope

Replace the scope everywhere, including the lockfile, generated templates and the README animations.

## Out of scope

Renaming the project, the repository or `create-longhorn`.

## Acceptance checks

Build, types, source tests, the rehearsal and all hosted CI jobs pass, and no `@longhorn/` reference remains.

## Evidence

1 November 2026, macOS ARM64, Node 20.19.4. `pnpm build` and `pnpm typecheck` clean, `pnpm test` 749 of 749, and `test:tasks`, `verify-otlp`, `verify-npm-rehearsal`, `verify-sqlite-project` and `verify-auth` exit 0. The animations were rebuilt. `longhorn` returned 200 and `longhornjs` 404 from the registry organization endpoint, which suggests the name is free but does not reserve it.
