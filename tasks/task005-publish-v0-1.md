---
id: task005
title: Publish v0.1 to npm
status: backlog
paths:
  - packages/
  - runtimes/
  - create-longhorn/package.json
  - cli/package.json
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
- Secure the `@longhorn` npm scope. On 31 October 2026 `@longhorn/core`,
  `create-longhorn` and `longhorn` returned 404 from the registry, which does not prove
  the scope is free.
- Release tooling and a changelog.
- A CI gate that installs from the published tarballs.

## Acceptance checks

On a clean machine, `npm create longhorn@latest my-api` creates an app that starts.

## Evidence
