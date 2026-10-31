---
id: task017
title: Run the outbox, PostgreSQL and transaction gates in hosted CI
status: done
paths:
  - .github/workflows/verify.yml
  - .github/rulesets/main.json
  - docs/repository-settings.md
  - docs/development-handoff.md
  - docs/supported-runtimes.md
  - README.md
  - site/index.html
  - docs/assets/
shared:
depends:
---

## Goal

The gates behind the project's main claim, surviving failure, run on hosted Ubuntu and not only on macOS.

## Owner direction

31 October 2026: "do what ever is good bro just do it", after the next-steps list put this third.

## Read first

- [scripts guide](../scripts/AGENTS.md)
- [Release verification](../docs/release-verification.md)

## Scope

Add the 15 gates missing from `verify.yml` as two jobs, `durable-delivery` and `worker-runtime`. `verify-command-development` and `verify-operator-preflight` already run inside `verify-command-app`. Fix what hosted Linux shows, without weakening a gate.

## Out of scope

New features. Making the new jobs required before they pass on main.

## Acceptance checks

Both jobs pass on hosted Ubuntu, and the docs and README counts are updated from that run.

## Evidence

31 October 2026, hosted Ubuntu 24.04. Run 41228077257 on `6bd18eb`, on pull request 64: all 10 jobs passed, and all 15 added gates passed on their first hosted run, with no gate changed. That is one pass, not a measure of flakiness, and it isn't yet on `main`. The two jobs aren't required checks yet. The `gates` piece was rebuilt and checked by frame in Chromium. Nothing has run on Windows.
