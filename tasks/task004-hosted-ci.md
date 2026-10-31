---
id: task004
title: Get hosted CI running and green
status: backlog
paths:
  - .github/workflows/verify.yml
---

## Goal

A real Ubuntu pass on the current code, with a status badge in the README.

## Owner direction

None yet.

## Read first

- [Release verification](../docs/release-verification.md)
- [Hosted status in the handoff](../docs/development-handoff.md)

## Scope

The repository is public, so Actions runs. The first full run, on `55a85bb`, passed 7 of 8
jobs. `source-and-runtimes` stopped at `verify-prune-packages`, fixed by `task011` in PR #56.
What remains: confirm the pass on `main`, then make the eight jobs required checks.

## Acceptance checks

All eight jobs pass on one exact commit, `docs/supported-runtimes.md` is updated, and the
jobs become required checks in the `main` ruleset. See `docs/repository-settings.md`.

## Evidence

31 October 2026. Run 41195228530 passed all eight jobs on Ubuntu 24.04 at `d4c5657`, the head of
PR #56. Not yet confirmed on `main`.
