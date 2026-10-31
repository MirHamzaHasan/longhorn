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
jobs. `source-and-runtimes` stops at `verify-prune-packages`: its first install is offline,
and with an empty pnpm cache there is no metadata for the pinned `pnpm@12.6.0`. Later gates in
that job have not run on Linux, so more failures may follow.

## Acceptance checks

All eight jobs pass on one exact commit, `docs/supported-runtimes.md` is updated, and the
jobs become required checks in the `main` ruleset. See `docs/repository-settings.md`.

## Evidence
