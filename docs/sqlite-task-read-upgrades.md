# Retained task read upgrades and native proof

Owner: the existing task migration manifest, storage startup and
[verify-persistence.mjs](../scripts/verify-persistence.mjs). Connects
[cursor pages](sqlite-task-pages.md), [aggregate counts](sqlite-task-counts.md),
[Node starter](sqlite-starter.md) and [Bun starter](bun-sqlite-starter.md).

The original 001_create_tasks SQL is unchanged. Its statement-list checksum stays
9adcc799e7043fa9130be0208cdf4271c97a707d0453bd3b2ec5ac752328dcdf.
Migration 002_index_tasks_completed_id appends one index on tasks(completed,id).
There is no table copy, task rewrite or ID reassignment. The shared
[migration runner](migrations.md) checks the complete history, then commits pending
DDL/history in its managed transaction before HTTP readiness.

Retained original databases gain the index on normal startup. Invalid history or
failed DDL stops readiness; it does not silently repair user schema. Earlier source
that knows only migration 001 will reject the newer history. Rollback requires a
reviewed application/schema procedure, not editing or deleting migration records.
The new application store API and bounded HTTP response require deliberate review
when adapting an existing generated project's source. There is no automatic updater.

The real storage tests create an original-prefix database, assert its pinned
checksum, insert a completed task, then start the new app and verify retained data,
index creation, unchanged original history and idempotent rerun. The same tests
ship to the generated Bun app with native runner/driver imports. Other tests cover
malformed queries, numeric 9/10 ordering, wide int64 cursors, deleted boundary rows,
completion filters, terminal cursors and aggregate counts.

`pnpm test:persistence` builds and runs actual Node HTTP processes. The shipped
tests/persistence.mjs is adapted into both SQLite starters and runs with their
native driver/executable. It first verifies concurrent writers, CRUD, restart,
two migration entries and SQLite integrity, then inserts enough retained tasks to
exceed Bun's default result-row limit. A 1029-row traversal verifies bounded pages,
strictly increasing unique IDs, both completion filters and one-row aggregate
summaries. The actual filtered query plan names the new index. Deleting a cursor
row and inserting another task preserves later traversal and updates summary totals.

Run `pnpm test:sqlite-project` and `pnpm test:bun-sqlite-project` for independent
packed/installed projects, native source/persistence tests and the existing
HTTP/watch/schema failure gates. The source-and-runtimes CI job runs both profiles.
The existing [cache](task-cache.md) and [event](task-events.md) native gates protect
the changed shared task integration. These are local-file/live-pagination proofs,
not snapshot pagination, distributed cache invalidation or cloud deployment.

## Local evidence

On macOS ARM64, frozen workspace installation, the full build/type checks and
514 source tests across 84 files passed. The installed generated Bun app passed
47 native tests in six files (228 assertions). Both packed SQLite variants passed
their shipped 1029-task persistence gate and HTTP/watch/failure checks. The native
Bun provider, memory cache/events, authenticated Redis task profile, D1 project and
all four default runtime projects passed their separate regressions. Validation
checked 309 source Markdown files and 2700 local links, and the original LICENSE
blob was preserved. Hosted Actions evidence is separate from these local results.
