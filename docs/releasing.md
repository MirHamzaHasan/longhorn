# Releasing to npm

Nothing has been published yet. This guide records how the first release is meant to go.

## What gets published

Every package in `packages/` and `runtimes/`, plus `cli/` and `create-longhorn/`: 23 in all, on one
shared version. `pnpm publish` rewrites `workspace:*` dependencies to that version.
`npm create longhorn` needs the unscoped `create-longhorn` name, and the other 22 need the
`@longhorn` npm organization.

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

On a machine with no checkout, run `npm create longhorn@latest my-api`, then install, start and call
`/health`. Update the README, the handoff and the changelog, which still say nothing is published.

## What the rehearsal does not prove

It installs local tarballs, so it doesn't prove the npm names are available, your account can publish,
or the registry serves the result. It generates the Node template only, and runs on the CI's Ubuntu
and whichever machine you run it on.
