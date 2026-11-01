---
id: task021
title: Record that 0.1.0 is on npm
status: review
paths:
  - docs/releasing.md
  - docs/development-handoff.md
  - docs/project-generation.md
  - docs/repository-settings.md
  - CHANGELOG.md
  - AGENTS.md
  - site/index.html
  - tasks/task005-publish-v0-1.md
  - .github/rulesets/main.json
  - docs/assets/
  - cli/src/asset-template.ts
  - cli/scripts/snapshot.mjs
  - scripts/verify-npm-rehearsal.mjs
shared:
depends:
---

## Goal

The docs say what is really on npm, and every template can generate from npm-installed packages in the next release.

## Owner direction

1 November 2026: "merge it and publish it".

## Read first

- [Releasing](../docs/releasing.md)

## Scope

Store each template's `.gitignore` under a name npm won't change, have the rehearsal generate every choice from an npm install, and record the 0.1.0 state.

## Out of scope

The version bump and README, which overlap active task020.

## Acceptance checks

`verify-npm-rehearsal` passes with every template, and the project gates still pass.

## Evidence

1 November 2026, macOS ARM64, Node 20.19.4. `pnpm build`, `pnpm typecheck` clean, `pnpm test` 749 of 749. `verify-projects`, `verify-sqlite-project`, `verify-auth-project`, `verify-d1-project` and `verify-npm-rehearsal` exit 0. With the bug put back in one template, the rehearsal failed, at `create-longhorn` for that template. The fix can't reach users until 0.1.1 is published, and that bump waits on task020's claim on every `package.json`.
