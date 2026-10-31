---
id: task016
title: Make the README heavily animated
status: done
paths:
  - README.md
  - docs/assets/
  - docs/website.md
  - tasks/task015-wow-readme.md
shared:
depends:
---

## Goal

Most sections of the README explain themselves through motion, without losing the text, the reduced motion stills or readable performance.

## Owner direction

31 October 2026: "now i want you to create readme for this project extremly animated with motion graphics".

## Read first

- [Website and README assets](../docs/website.md)

## Scope

A camera, word-by-word headlines, a shockwave and a live cursor in the film. New `stats`, `firstapp`, `journey`, `repo`, `gates`, `agents` and `divider` pieces. More motion in `stack` and `failures`.

## Out of scope

The website.

## Acceptance checks

Every local link resolves, every SVG parses, each piece is checked in real-time Chromium, and all pieces play together on one page.

## Evidence

31 October 2026, macOS ARM64, headless Chromium through Playwright, each SVG loaded as an image.

- All 21 README images on one page at 830 px: none broken, no page errors, 60.1 frames per second over 5 seconds with 0 slow frames. Headless Chromium here isn't a real phone or an average laptop.
- Frames were checked by eye for the film, `stats`, `firstapp`, `journey`, `repo`, `gates` and `agents`, with each `-still` twin. The film wasn't rechecked at 390 px after the camera was added.
- The code shown in `firstapp` ran against the built packages and returned `{"message":"Hello, Ada"}`. The README's larger sample returned the same.
- `gates` shows 66 gates, with 49 named in `verify.yml`. The README says about 50, because that count was set by an earlier check of what CI reaches.
- All local README links resolve, and all SVGs parse with `xmllint`.

Not checked: GitHub's own rendering on `main`. SVG animations start when the image loads, so a piece further down the page can be mid-loop when it's scrolled to.
