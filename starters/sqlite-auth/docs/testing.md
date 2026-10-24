# Source and native persistence checks

Owner: copied `src/app.test.ts` and `tests/persistence.mjs`.
`pnpm typecheck` checks editable source against the selected framework snapshot.
`pnpm test` runs the actual shared auth application cases using Node/Vitest,
Bun's native test runner or compiled Deno node:test with pinned real assertions.
Only test-runner and SQLite imports are mapped for native variants. Source tests
on Deno grant environment access because the pinned assertions inspect CI/vendor
settings; the application launcher's seven-key policy remains separate. Source tests
use a deliberately fake password provider; they are not crypto evidence.

The seven app cases cover strict input/origin/body bounds, current roles, owner
isolation/privacy, session rotation/expiry/revocation, durable retry policy and
bounded note pages/deleted/maximum-int64 cursors with actual native SQLite.
They also cover password replacement, preserved peers/notes, cookie clearing and
shared reauthentication throttling.

`pnpm test:persistence` builds first, then starts real native HTTP processes using
the project's actual password and SQLite adapters. It checks real signup/login,
cookie flags, private notes, process restart, concurrent-host session rotation,
all-device revocation, actual password replacement, throttle retention, secret-free logs and clean native close.
It creates temporary accounts/database only and joins owned hosts before cleanup.
It never uses normal application data. This gate does not perform a production
backup, cloud failover or account-recovery test.

Development/source reload, configuration denial, schema drift and selected Deno
permissions are additionally checked by the LongHorn repository's packed/relocated
distribution gate. A successful install/typecheck alone is not native runtime
evidence. Consult the repository runtime matrix for executed OS/version profiles.
The POSIX gate also interrupts the watcher process group and requires actual
native drain, clean owner exit and listener release.
