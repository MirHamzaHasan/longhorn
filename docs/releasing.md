# Releasing to npm

0.1.0 was published on 31 October 2026 UTC. This guide records how a release goes.

## Known problem in 0.1.0

Only the default API template generates from the npm packages. Every `--template` choice fails with
"template assets are unavailable or invalid", because npm renames `.gitignore` to `.npmignore` when
it installs a package, which broke the templates' file hashes. Assets now store it as
`gitignore.asset`. A checkout with `pnpm create:app` was never affected. The fix needs a new release.

## What gets published

Every package in `packages/` and `runtimes/`, plus `cli/` and `create-longhorn/`: 23 in all, on one
shared version. `pnpm publish` rewrites `workspace:*` dependencies to that version.
`npm create longhorn` needs the unscoped `create-longhorn` name, and the other 22 need the
`@longhornjs` npm organization. The `longhorn` organization was already taken on npm, so the
scope differs from the project's name.

## Before publishing

1. Be on a clean, up-to-date `main` with CI passing.
2. Confirm that the version is new and that `CHANGELOG.md` has its date.
3. Run `pnpm build && node scripts/verify-npm-rehearsal.mjs`.

The rehearsal touches nothing on npm. It packs every package, checks each tarball, installs them in
an empty folder, generates a project with `create-longhorn`, then builds, starts and calls it.

## Publishing

Log in with an account that owns the organization and has two-factor authentication on:

```sh
npm login
pnpm release:npm
```

`release:npm` runs the rehearsal first, then publishes in dependency order, and it asks for a
one-time password. A published version can't be reused, and it can only be unpublished under npm's
limits, so treat it as permanent.

## After publishing

Expect a few minutes before everything resolves. npm publishes new names in stages: a `0.0.0-stage`
placeholder comes first, and `npm create` can return "could not determine executable" or a 404 until
all the packages and their files are available.

On a machine with no checkout, run `npm create longhorn@latest my-api`, then install, start and call
`/health`. Update the README, the handoff and the changelog, which still say nothing is published.

## What the rehearsal does not prove

It installs local tarballs, so it doesn't prove the npm names are available, your account can publish,
or the registry serves the result. It generates every runtime and template choice, and builds and starts only the
default and SQLite projects. It runs on the CI's Ubuntu and whichever machine you run it on.
