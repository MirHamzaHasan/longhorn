# Native Bun SQLite verification

Owner: [verify-bun-sqlite.mjs](../scripts/verify-bun-sqlite.mjs), using the pinned
Bun 1.4.4 executable and built framework entrypoints. Run `pnpm test:bun-sqlite`,
or `node scripts/verify-bun-sqlite.mjs` after a full build. The source-and-runtimes
CI job runs this gate after its normal source/runtime checks.

The [native Bun suite](../runtimes/bun/test/sqlite.test.mjs) covers exact int64/float/
boolean/null/blob mapping, queued snapshots, strict binds, trigger/direct change
counts, statement-prefix rejection and sanitized native diagnostics. It verifies
async DDL/data rollback, expired executors, caught native automatic rollback,
same-file/symlink ownership, bounded admission, actual close draining, joined
participants and caught publisher failure. Result-limit checks distinguish a
committed autocommit write from a rolled-back callback write. Migration races retain
one exact history through reopen. Existing queue publication, scheduler dispatch,
job consumption and callback replay execute on the actual native connection.

Separate [Bun child processes](../scripts/fixtures/bun-sqlite-process.mjs) prove
uncommitted writes disappear after SIGKILL and acknowledged commits survive it.
A held write transaction makes a second process reach its native busy timeout;
the fixed storage error does not echo SQL and no contender row is replayed later.
Reopened databases pass SQLite integrity_check.

Actual Bun HTTP hosts prove validation, create/read/update/delete, process-local
activity reset, summary reads, two-process concurrent writers, unique IDs and
retained data after SIGTERM/SIGINT restarts. Files use paths with spaces and #.
The verifier owns/cleans every child and temporary directory on failure.

The general Vitest suite continues to test source in Node; it does not fake the
`bun:sqlite` module. Native Bun tests are intentionally outside its source glob.
The shared scanner also requires [D1 regression](d1-testing.md), and the changed
Bun package closure requires the four-runtime [fresh-project gate](project-generation.md).
This proof targets local files, the pinned Bun executable and the current OS SQLite
implementation. Linux CI is separate evidence; it does not establish replication,
hard-link/file-replacement coordination, distributed locking or all optional stores.

## Local evidence

On macOS ARM64 with Bun 1.4.4, frozen installation, the full workspace build and
type checks passed. The source suite passed 509 tests in 84 files; the native Bun
suite passed 13 tests with 81 assertions, followed by the actual process/HTTP gate.
Native Bun/Deno/workerd adapters, D1 storage/schema/tasks and request replay passed.
All four fresh runtime projects plus packed D1 and Node SQLite projects passed
their own install/build/native checks. Markdown validation checked 282 source
files and 2533 local links, and the original LICENSE blob was preserved.

These are local results. Hosted verification must be reported separately from
GitHub's Actions runner budget and artifact quota, which have blocked earlier PRs.

See [provider](bun-sqlite.md), [transaction ownership](bun-sqlite-transactions.md),
[statement boundary](sqlite-statement-boundary.md) and [task host](bun-sqlite-tasks.md).
