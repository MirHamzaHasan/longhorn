# Native password and auth verification

Owner: `scripts/verify-password-runtimes.mjs`, its native fixtures under
`scripts/fixtures`, and the parameterized `scripts/verify-auth.mjs`.
The local profile is Node 20.19.4, Bun 1.4.4 and Deno 2.9.6 on macOS ARM64.

```sh
pnpm test:password-runtimes # built native password policy and drain
pnpm test:native-auth      # password gate plus mixed native HTTP auth
pnpm test:auth             # original Node HTTP plus workerd shared-auth gate
```

The password gate creates a legacy v1 vector using raw Node crypto, independently
of Longhorn's policy. Actual Node/Bun/Deno processes verify that vector, previous
peer hashes, exact Unicode/whitespace, wrong passwords and strict malformed hashes.
Each produces a fresh hash; raw Node crypto independently rederives every produced
key. Native tests also prove real timer progress during derivation, oversized UTF-8
rejection, shared dummy-work admission, bounded queues and recovery after work.
Test records contain only temporary fixture credentials and are removed in cleanup.
Summaries/log checks do not expose passwords or encoded hashes.

For every native runtime, a real auth host starts registration and reports entry
into the actual native password operation. The parent then sends SIGTERM. The
gate requires the accepted HTTP request to finish with 201, native work to settle
before application stop, clean actual process exit and one committed user in an
intact SQLite file. The monitored fixture delegates to the real adapter; it does
not replace the KDF with a timer. Cleanup joins only owned children before deleting
temporary state.

The browser policy fixture is bundled for actual workerd and uses an explicit
test-only driver. It proves shared policy isolation and execution, not Worker
password security. There is no production Workers password provider here.

## Mixed retained auth

`node scripts/verify-auth.mjs bun` starts Bun as the primary host, Node as its
peer and Deno as a third host against one temporary SQLite file. Native credential
creation/login and cross-host session rotation, current roles, revocation,
throttling, restart retention, origin/cookie boundaries and secret-free logs are
checked. Each host traverses more than 1000 private notes in bounded owner pages,
including strict query rejection, deleted cursors and exact int64 ownership.
The `deno` primary mode is also available; no runtime is simulated.

Source policy tests use deliberately fake drivers for deterministic failure and
reservation handoff checks. Existing Node password tests and the independent
Node/PostgreSQL command-application gate protect consumers of the refactored
Node adapter. Frozen packed/relocated project gates verify the changed selected
framework graph includes the new shared export.

CI config runs the native password, Node auth and mixed auth gates in the existing
source/runtime job. Exact-head hosted results remain subject to runner availability;
the [runtime matrix](supported-runtimes.md) distinguishes local execution from
hosted evidence. See [policy](scrypt-password-policy.md), [Bun](bun-passwords.md),
[Deno](deno-passwords.md), [hosts](native-auth-example.md) and
[private-note pages](auth-note-pages.md) for the implemented boundaries.
