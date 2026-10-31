---
id: task019
title: Fix the prune gate's tarball name after the scope rename
status: done
paths:
  - scripts/verify-prune-packages.mjs
shared:
depends:
---

## Goal

`verify-prune-packages` finds its tarballs under the renamed scope.

## Owner direction

1 November 2026: "merge it and publish it". CI on main failed after the rename.

## Read first

- [scripts guide](../scripts/AGENTS.md)

## Scope

The gate built tarball paths from a literal `longhorn-` prefix, which the rename to `@longhornjs` did not match. It now derives the name from the package name.

## Out of scope

Other gates. A search of scripts, CLI, starters and workflows found no other copy of this pattern.

## Acceptance checks

The gate exits 0 locally and `source-and-runtimes` passes on hosted CI.

## Evidence
1 November 2026, macOS ARM64, Node 20.19.4: the gate failed before this change and exits 0 with it. Hosted run on `fc80009` failed at this step.
