# Bun asynchronous SQLite transaction ownership

Owner: `@longhornjs/bun/sqlite`, connected to
[`@longhornjs/database/transactions`](transaction-executors.md). A queued root
transaction opens native BEGIN IMMEDIATE, awaits application work, drains accepted
participants, then commits. Application or participant failure drains and rolls back.
The provider does not use Bun's synchronous transaction-wrapper API for async work.

Use only the supplied executor inside the callback. Root execute, transaction and
close calls on the owning or another same-file handle reject in that context.
Opening a new same-file handle from the callback also rejects. Nested transactions
and savepoints are outside this API; manual transaction-control SQL is rejected.

Canonical real paths share an in-process FIFO gate across handles. Transactions
retain the gate across await, preventing another native synchronous call in the
same event loop from blocking the callback that owns the lock. Existing symlinks
resolve to the same gate; parent directories are canonicalized for new files.
Cross-process contention remains native SQLite locking. Replacing files, hard-link
aliases, attached databases and separate copies of the provider module do not gain
this shared coordination. Avoid composing nested transactions across databases.

The [managed scope](transaction-executors.md) identifies this exact Database handle.
A different same-file handle is not the same publisher owner. Completion seals the
public executor; registered participant executors retain narrowly scoped access
until drained. A participant failure still prevents commit when application code
catches its rejected promise. Retained/forged executors cannot publish later.

SQLite can roll back natively on an OR ROLLBACK conflict. The delegate checks
`inTransaction` before further SQL and before commit. Once ownership is lost,
catching that SQL error cannot turn later executor writes into autocommitted work.
The connection can accept a fresh root transaction after the rejected scope ends.

The existing [SQLite queue publisher](sqlite-transaction-publishing.md),
[scheduler store](scheduler-sqlite.md) and [callback idempotency store](idempotency-sqlite.md)
use this Database without a new storage protocol. Queue publication must register
before the callback returns; use enqueueInTransaction for joined asynchronous
validation. Plain detached JavaScript work is not implicitly a participant.
These statements describe SQL atomicity; network calls and in-memory events do
not become transactional. See the [native proof](bun-sqlite-testing.md).
