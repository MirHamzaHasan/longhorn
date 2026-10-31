---
id: task010
title: Public README and collaboration guide
status: review
paths:
  - README.md
  - docs/assets/
  - site/index.html
  - CONTRIBUTING.md
  - AGENTS.md
  - docs/repository-settings.md
  - docs/website.md
  - docs/development-handoff.md
  - tasks/task009-go-public.md
  - tasks/task004-hosted-ci.md
shared:
depends:
---

## Goal

A newcomer can understand LongHorn from the README, and can see how to contribute.

## Owner direction

31 October 2026: "make it public create once nice readme which explain proper understanding
of project completely ready for collaboration", then "using this skill create nice motion
graphic based very very nice read me", naming https://github.com/iammirrr/ungenerated.

## Read first

- [Website and README assets](../docs/website.md)

## Scope

The README, its motion pieces and generator, the contributing guide, and the status docs
that said the repository was private.

## Out of scope

Fixing hosted CI, which is `task004`.

## Acceptance checks

Local links resolve, and motion frames are checked at exact times. The animations are then
checked as GitHub really serves them.

## Evidence

31 October 2026. Chromium on macOS: film frames scrubbed at exact times, plus real-time capture
inside `<img>`. The README was loaded from github.com on this branch at 1280 and 390 wide:
`film.svg`, `hosts.svg` and `quickstart.svg` were chosen and served as `image/svg+xml`, the
film's frames changed over time, the Mermaid diagram rendered, and there was no overflow.
Firefox, Safari and the GitHub mobile app were not checked.
