---
id: task015
title: README motion that explains the framework
status: done
paths:
  - README.md
  - docs/assets/
  - docs/website.md
shared:
depends:
---

## Goal

The README explains the framework through motion: why it exists, what modules an app uses, and what happens when things fail.

## Owner direction

31 October 2026: "https://github.com/iammirrr/ungenerated thats the skill and now create readme like wow perfect readme wiht great motion animation to explain things and docs overall wow factor readme".

## Read first

- [Website and README assets](../docs/website.md)

## Scope

A new film in one app window, a `stack` piece that replaces the Mermaid diagram, a `failures` piece for the four tested failures, a rebuilt `quickstart`, a restyled `hosts`, and a docs guide section. A first version on navy with a condensed font was rejected by the owner, who asked for Mobbin references. Stripe, Antimetal and Railway were studied for direction, showing the working surface under a large headline.

## Out of scope

The website, which keeps its own style.

## Acceptance checks

Every local README link resolves. Each piece is checked in real-time Chromium frames at GitHub's width, and the film at phone width too.

## Evidence

31 October 2026, macOS ARM64, Chromium through Playwright, with each SVG loaded in an image as GitHub does. Frames were checked at 830 px for all five pieces, with the `-still` twins for each. The film was also checked at 390 px. All local README links resolve, and all SVGs parse with `xmllint`. GitHub's own rendering can only be checked after merge. No real phone or VoiceOver was used.
