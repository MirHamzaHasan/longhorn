---
id: task007
title: Animated website and developer README
status: done
paths:
  - site/
  - README.md
  - docs/examples-tour.md
  - docs/website.md
  - docs/assets/
  - .github/workflows/pages.yml
shared:
  - docs/features.md
---

## Goal

A developer landing on the repository or website understands what LongHorn is, can
run it, and is never misled about what is finished.

## Owner direction

31 October 2026: "create nice github page for that nicenly animated one and nice
animated readme that will help developers".

## Read first

- [Architecture guide](../docs/project-guide.md)
- [Runtime matrix](../docs/supported-runtimes.md)

## Scope

- A static site in `site/`, deployed by its own Pages workflow.
- A rewritten README with animated SVGs that work on GitHub.
- The old README's full walkthrough moved to `docs/examples-tour.md`, not lost.

## Out of scope

Enabling Pages or changing repository visibility. Those are the owner's.

## Acceptance checks

- Real screenshots at desktop and phone widths, and with reduced motion.
- Every command shown was run, or exists in `package.json`.
- Every relative link in the README and tour resolves.

## Evidence

31 October 2026, macOS ARM64, Node 20.19.4, Playwright Chromium 1.64.1:

- Site: axe WCAG A and AA found 0 violations at 1440px and 390px. No page errors or
  failed requests, and no horizontal overflow at 320, 390, 768, 1024 and 1440px.
- All five scenarios finish with the expected tallies. Switching scenario mid-run
  cancels cleanly. With reduced motion, each shows its finished state at once.
- Keyboard: tab order, arrow keys on tabs and radios all work.
- Picker: all 12 runtime and template combinations generated with `create-longhorn`.
- Quickstart: created, installed and started; `/health` returned the output shown.
- README sample: typechecks and returned `{"message":"Hello, LongHorn"}`.
- SVGs: frames captured through `<img>` over HTTP. Animated and still versions checked.
- 243 relative links checked, 0 broken. Every `pnpm` script named exists.
- `pnpm build` and `pnpm typecheck` exit 0. `pnpm test` passes 749 of 749.

Not checked: GitHub's real rendering of the README, and the Pages workflow. Neither can
run before a push. No Firefox or Safari, and no screen reader on a device.
