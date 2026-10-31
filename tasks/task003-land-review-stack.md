---
id: task003
title: Land the 40 stacked draft PRs on main
status: done
paths:
  - docs/development-handoff.md
depends:
  - task002
  - task004
---

## Goal

`main` holds the framework. Today it holds only the initial commit, and 52 commits sit
in 40 draft PRs stacked on each other.

## Owner direction

31 October 2026: "yes push it to main set all github rules as this is going to be opensource project".

## Read first

- [Handoff](../docs/development-handoff.md)
- `gh pr list --state open`

## Scope

Recommended: because each PR stacks on the last, review the top of the stack as one
change, merge it to `main`, then close the rest as superseded with a link. Merging 40
one at a time costs 40 CI runs and retargets for no extra safety. The owner may
prefer otherwise.

## Out of scope

Rewriting history or squashing away the commit messages.

## Acceptance checks

- `main` contains the live history commit.
- The full verification workflow has passed on `main` itself.

## Evidence

31 October 2026: the stack was fast-forwarded to `main`, keeping every commit. The
verification workflow has not passed on `main`; that remains `task004`.
