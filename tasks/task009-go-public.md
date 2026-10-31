---
id: task009
title: Make the repository public and turn on branch protection
status: done
paths:
  - .github/rulesets/
  - docs/repository-settings.md
---

## Goal

The repository is public, `main` is protected and the website is live.

## Owner direction

31 October 2026: "set all github rules as this is going to be opensource project", then
"yes bro make it public".

## Read first

- [Repository settings](../docs/repository-settings.md)

## Scope

Run the commands in the guide, and check them with
`gh api repos/MirHamzaHasan/longhorn/rulesets` and by loading the website.

## Acceptance checks

- A direct push to `main` from a non-admin is refused.
- Secret scanning and private vulnerability reporting are on.
- The website loads, and the README animations play on GitHub.

## Evidence

31 October 2026. `gh repo view` reports PUBLIC. `gh api .../rules/branches/main` returns
deletion, non_fast_forward, required_linear_history and pull_request. Secret scanning, push
protection and private vulnerability reporting report enabled. The Website workflow passed,
and the site returned HTTP 200. A direct push from a non-admin was not attempted.
