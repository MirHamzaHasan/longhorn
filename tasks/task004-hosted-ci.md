---
id: task004
title: Get hosted CI running and green
status: done
paths:
  - .github/workflows/verify.yml
  - .github/rulesets/main.json
  - docs/repository-settings.md
  - docs/development-handoff.md
  - docs/supported-runtimes.md
  - tasks/task010-public-readme.md
  - tasks/task011-prune-gate-cache.md
  - tasks/task012-otlp-metrics-gate-retry.md
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
PR #56. Run 41215461094 passed all eight on `main` at `6977d4e`, and the website deployed. The eight jobs were then added to the live ruleset, and `rules/branches/main` lists `required_status_checks`. `independent-distribution` failed in 3 of 12 runs that day, which `task013` addresses.
