# Native Bun SQLite

src/storage.ts selects @longhorn/bun/sqlite behind the shared Database interface.
Native bun:sqlite executes synchronously, including busy waits. The async facade
owns queued work, callbacks and shutdown; it does not make SQLite I/O nonblocking.
Startup enables foreign keys, WAL, synchronous FULL and a bounded busy timeout.

One statement and positional parameters are validated/copied before admission.
Integers are bigint, blobs are copied Uint8Array and booleans bind as integer 1/0.
The repository maps IDs to decimal strings before HTTP JSON. Direct change counts
exclude triggers; use RETURNING for authoritative inserted values. Manual
transaction controls and trailing statements reject.

Async callback transactions own BEGIN IMMEDIATE through managed participants and
commit/rollback. Same-file handles coordinate across await; callback root operations
must use their supplied executor. Lost native ownership prevents caught OR ROLLBACK
errors from turning later writes into autocommit. Do not retain expired executors.

Defaults bound accepted root work to 64 operations and output to 1000 rows/1 MiB.
Native output is materialized first; an autocommitted write can persist even when
result decoding rejects. Do not blindly retry writes. SQL itself must be trusted;
statement checks are not an arbitrary-SQL sandbox. Task pages fetch at most 101
rows and summaries use one aggregate row. Local files, WAL sidecars and
SQLite locking stay application-owned. Close drains accepted work without deleting
retained state. See [migrations](migrations.md), [tasks](tasks.md) and [testing](testing.md).
