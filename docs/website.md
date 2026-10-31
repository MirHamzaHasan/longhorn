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

`docs/assets/film.svg` is one continuous take in one app window, with the server log on the
left and the database on the right: one command, a kill, an outage and a receipt. `docs/assets/hosts.svg` shows the same app moving between hosts,
`docs/assets/stack.svg` shows which modules real examples import,
`docs/assets/failures.svg` plays the four tested failures in turn, and
`docs/assets/quickstart.svg` is the terminal session. `stats`, `firstapp`, `journey`, `repo`,
`gates`, `agents` and `divider` carry the rest of the page. They animate with CSS only, which
GitHub allows in images. All text is converted to paths, so no font has to load.

`docs/assets/build-readme-motion.mjs` builds all of them, and its header
gives the command. Edit the generator, not the SVGs:

- Show the working surface, not an abstract diagram. The numbers leave the log, become
  database rows and land on the receipt's first line. When the log dies, the rows stay lit.
- The film's log lines are an illustration of the sequence, not captured output.
- Each object has one timeline, using transforms and opacity only.
- Words change in one slot, so the eye doesn't have to find them again.
- Anything the film shows must match the guide that tests it. The kill is in
  [transaction publishing testing](transaction-publishing-testing.md), and the outage in
  [persistent operations testing](persistent-operations-testing.md). Three attempts is
  an example, not a limit.
- `stack` reads each example's `package.json`, `stats` reads the test count, gates and packages,
  and `gates` reads `scripts/` and `verify.yml`, all at build time. Rebuild when those change.
- The code in `firstapp` must run and return what it shows. `agents` uses example task numbers. `failures` follows the failure table in the README and its guides.

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
