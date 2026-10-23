# Local PostgreSQL demo and verification

Owner: scripts/postgres-cluster.mjs, postgres-sandbox.mjs, demo-postgres.mjs and
verify-postgres.mjs. Connects [provider](postgres.md), [migrations](postgres-migrations.md),
[restricted roles](postgres-roles.md) and [the app](postgres-example.md).

`pnpm demo:postgres` builds, creates a new temporary cluster/database/roles, applies
the actual example migration exports, grants runtime resources, and starts the
compiled app at loopback port 3003 (override PORT). Ctrl+C stops its app/server and
removes that cluster. The demo explicitly has temporary data. It does not start,
stop, upgrade, repair or connect to the user's normal PostgreSQL service.

`pnpm test:postgres` builds then creates another owned temporary cluster. It invokes
the separate vitest.postgres.config.ts suite with generated owner/runtime URLs,
then races migration processes, kills a process inside DDL/metadata work, checks
recovery, runs the compiled migration CLI and exercises two HTTP writer processes.
It restarts HTTP against the same database to prove persistence, validates password
failure, closes pools/server, and removes temporary files. Normal pnpm test excludes
the native .postgres.test.ts suites, so no implicit external DB is queried.

The same gate verifies [background queues/schedules](postgres-background-testing.md)
with competing native processes, forced crashes and producer/worker HTTP restart.
The demo includes [task reports](postgres-reports.md) with worker/timing hosts enabled.
It also includes [accounts/private notes](postgres-accounts.md); account Origin/cookie
settings must match the browser-facing origin. The native gate adds [scrypt/account
process proofs](postgres-auth-testing.md) without accessing any normal database.

The default engine comes from pinned embedded-postgres 18.4.0-beta.17 platform
binaries (the real PostgreSQL 18.4 server, not a JS/WASM mock). Only its binary paths
are used; LongHorn owns initdb/process lifecycle. The package's reviewed postinstall
rehydrates internal library symlinks. The workspace explicitly permits that build
for the verified darwin-arm64 package. Other platforms require a reviewed matching
platform build permission or an explicit LONGHORN_PG_BIN directory containing working
initdb/postgres binaries. Native PostgreSQL must run as a non-root OS user; the helper
never creates/modifies operating-system accounts. See the [binary project's documentation](https://github.com/leinelissen/embedded-postgres).

The server listens only on 127.0.0.1 at an available TCP port; Unix sockets are
disabled. Host authentication is SCRAM, and bootstrap/runtime passwords are random.
The initial native startup has a bounded initdb deadline; later ready checks inspect
the live process/connectivity. Failures stop only owned processes and remove only
their temporary directory. The helper does not patch system libraries or disable
platform security. It was verified on macOS/ARM64; other engines/platforms need their
own native gate rather than inferred compatibility.

For durable local or deployed development, provision a server and separate roles,
then supply credential URLs and run migrate:postgres/dev:postgres. Those commands
use the supplied database and do not remove it. The application contains no server
installer, background service manager, automatic schema repair or production deploy.
