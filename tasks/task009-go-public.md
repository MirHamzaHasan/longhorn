---
id: task009
title: Make the repository public and turn on branch protection
status: blocked
paths:
  - .github/rulesets/
  - docs/repository-settings.md
---

## Goal

The repository is public, `main` is protected and the website is live.

## Owner direction

31 October 2026: "set all github rules as this is going to be opensource project". The
owner has not yet said to change visibility, and that can't be recalled once copies exist.

## Read first

- [Repository settings](../docs/repository-settings.md)

## Scope

Blocked on the owner's word. GitHub refuses rulesets and branch protection on this private
repository, and Pages too. Then run the commands in the guide, and check them with
`gh api repos/MirHamzaHasan/longhorn/rulesets` and by loading the website.

## Acceptance checks

- A direct push to `main` from a non-admin is refused.
- Secret scanning and private vulnerability reporting are on.
- The website loads, and the README animations play on GitHub.

## Evidence
