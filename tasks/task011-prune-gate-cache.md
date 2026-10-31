---
id: task011
title: Let the prune gate start from an empty pnpm cache
status: backlog
paths:
  - scripts/verify-prune-packages.mjs
shared:
depends:
---

## Goal

`verify-prune-packages` passes on a machine with an empty pnpm cache, including hosted CI.

## Owner direction

None. Found by the first full hosted run, on `55a85bb`. It is the step that stops `source-and-runtimes`; see `task004`.

## Read first

- [scripts guide](../scripts/AGENTS.md)

## Scope

The first install only generates the lockfile, but with `--offline` it can't resolve the pinned `pnpm@12.6.0` from an empty cache. Let that install use the network. The relocated install stays `--frozen-lockfile --offline`, and that is the independence proof.

## Out of scope

Failures in later gates, which belong to `task004`.

## Acceptance checks

The gate exits 0 with `XDG_CACHE_HOME` set to an empty folder, and the step passes in hosted CI.

## Evidence

31 October 2026, macOS ARM64, Node 20.19.4. With an empty `XDG_CACHE_HOME`, the unchanged gate exited 1 with `ERR_PNPM_BAD_CONFIG_DEP`, the same error as CI. With this change it exited 0. That run used a scratch copy of the gate against this repository's existing build.
