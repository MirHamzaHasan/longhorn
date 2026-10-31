# Website and README assets

Owner: `site/` and `docs/assets/`. Connects the public description of LongHorn to the
[runtime matrix](supported-runtimes.md) and [handoff](development-handoff.md), which
hold the facts it repeats.

## Website

`site/` is plain HTML, CSS and JavaScript with no build step and no third-party
scripts. Its fonts are self-hosted. Preview it with:

```sh
node site/serve.mjs
```

The page runs at http://127.0.0.1:4173/. `.github/workflows/pages.yml` deploys the
folder on pushes to `main` that change it.

The "Break it yourself" section is an animation of behaviour, not a live server. Each
scenario links to the guide for the gate that tests it. Change a scenario only to match
that guide. With reduced motion, a scenario shows its finished state straight away.

## Publishing the site

Nothing is live yet, and these steps belong to the repository owner:

1. Make the repository public, or move to a paid plan. Pages on a private repository
   needs a paid plan, and Actions has been refusing jobs on this repository's budget.
2. Follow [repository settings](repository-settings.md), which also enables Pages.

The address will be https://mirhamzahasan.github.io/longhorn/.

## README animations

`docs/assets/{hero,flow,quickstart}.svg` animate with CSS and SMIL only, which GitHub
allows in images. All text is converted to paths, so no font has to load.

Each has a `-still.svg` twin. The README's `<picture>` picks it with
`media="(prefers-reduced-motion: reduce)"`. Do not put that media query inside the SVG:
inside an image, Chromium reports reduced motion as on, which stops the animation for
everyone.

## Keeping it true

The test counts and the "Not claimed" lists appear in both the site and the README.
Update both when those facts change, especially when packages are published or
hosted CI passes.

## Verification

Browser checks use real Chromium captures. See `tasks/task007-website-and-readme.md`
for the last run. GitHub's own rendering of the README can only be checked after a push.
