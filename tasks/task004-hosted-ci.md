---
id: task004
title: Get hosted CI running and green
status: blocked
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

Blocked on the owner. The repository is private on a free plan, and every run since at
least PR #35 ended before a runner started because of the Actions budget. Making the
repository public gives free Actions minutes, and so does adding budget. After that,
expect real failures from Linux, because recent gates were only run on macOS ARM64.

## Acceptance checks

All eight jobs pass on one exact commit, `docs/supported-runtimes.md` is updated, and the
jobs become required checks in the `main` ruleset. See `docs/repository-settings.md`.

## Evidence
