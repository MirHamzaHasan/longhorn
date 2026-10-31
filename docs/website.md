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

The site is live at https://mirhamzahasan.github.io/longhorn/.
`.github/workflows/pages.yml` deploys it. See [repository settings](repository-settings.md).

## README animations

`docs/assets/film.svg` is one continuous take: one command, a crash, an outage and a
receipt. `docs/assets/hosts.svg` shows the same app moving between hosts, and
`docs/assets/quickstart.svg` is the terminal session. They animate with CSS only, which
GitHub allows in images. All text is converted to paths, so no font has to load.

`docs/assets/build-readme-motion.mjs` builds the film and the hosts piece, and its header
gives the command. Edit the generator, not the SVGs:

- The world stays put and a camera moves over it. The chip is one object, on screen
  from the first beat to the receipt, and it lands on its own row.
- Each object has one timeline, using transforms and opacity only.
- Words change in one slot, so the eye doesn't have to find them again.
- Anything the film shows must match the guide that tests it. The kill is in
  [transaction publishing testing](transaction-publishing-testing.md), and the outage in
  [persistent operations testing](persistent-operations-testing.md). Three attempts is
  an example, not a limit.

Each piece has a `-still.svg` twin, its settled frame. The README's `<picture>` picks it
with `media="(prefers-reduced-motion: reduce)"`. Do not put that media query inside the
SVG: inside an image, Chromium reports reduced motion as on, which stops the animation
for everyone.

## Keeping it true

The test counts and the "Not claimed" lists appear in both the site and the README.
Update both when those facts change, especially when packages are published or
hosted CI passes.

## Verification

Browser checks use real Chromium captures. See `tasks/task007-website-and-readme.md`
for the last run. GitHub's own rendering of the README can only be checked after a push.
