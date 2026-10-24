# Packed native auth project verification

Owner: `scripts/verify-auth-project.mjs` plus generated `tests/persistence.mjs`.
`pnpm test:auth-project` builds first, then checks Node, Bun and Deno sequentially.
An individual mode is available as `node scripts/verify-auth-project.mjs deno`
after building. The executed local profile is recorded in the
[runtime matrix](supported-runtimes.md); hosted execution is separate evidence.

The gate packs and installs actual CLI/creator archives, uses the installed binary
with automatic installation, relocates each project and checks its exact editable
app/host/test mapping and selected framework graph. Every shipped source/package/doc
asset is scanned for workspace paths/dependencies. Frozen installation leaves the
lock unchanged; installed CLI typecheck/test/build commands execute independently.
All five source auth cases run with actual selected native SQLite. Their explicitly
fake password provider is test-only, so the separate native gate is required.

The shipped persistence command creates temporary users and exercises real native
signup/login, owner/origin/role boundaries, retained notes/sessions across restart,
two-host rotation/all-device revocation, durable throttle, secret-free logs and
clean actual process close. It uses the generated launcher and never the normal
project database. Cleanup joins all owned hosts before removing temporary state.

The outer installed gate independently rederives stored native hashes with raw
Node crypto, checks fresh roles through two actual native HTTP hosts and traverses
1006 owner notes while excluding another owner's data. It verifies environment-file
and process precedence, project-relative comma/space data paths, retained sessions,
integrity and unchanged original migration count. Deno's actual live named policy
is inspected and reused for real outside-path/env/run/network denial; policy files
must disappear after shutdown/failure.

For every runtime the gate also proves compile-failure service retention, serial
source replacement, listener release, invalid-config pre-acquisition denial,
changed applied migration rejection and retained recovery after restoring source.
On POSIX it also sends SIGINT to the direct watcher's process group and requires
native/application drain, successful owner exit and listener release. This checks
terminal ownership separately from the CLI's single-owner signal forwarding.
Captured logs must omit test passwords, raw tokens and encoded hashes. Owned
children and temporary projects are cleaned; no normal application state is used.

CI adds this gate to the existing source/runtime job. The exact-head run/runner
state governs hosted claims. See [profile](auth-starter.md),
[checked snapshot](auth-starter-snapshot.md), [launch policy](auth-starter-launcher.md)
and [development](auth-starter-development.md).
