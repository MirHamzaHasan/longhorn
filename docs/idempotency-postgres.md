# PostgreSQL idempotent producers

Owner: `@longhornjs/idempotency/postgres`, PostgresIdempotencyStore and
postgresIdempotencyMigrations. Connects [provider transactions](postgres-transactions.md),
[transactional queues](postgres-transaction-publishing.md), [roles](postgres-roles.md),
[retention](idempotency-storage.md) and [HTTP integration](idempotency-http.md).

Append the feature migrations to the application's existing owner history. They
create a dedicated schema/table, revoke PUBLIC access and add the expiry index.
The PostgreSQL example appends them after its deployed private-note history. DDL
uses the owner role; the runtime gets schema USAGE and table SELECT/INSERT/UPDATE/
DELETE. DELETE supports explicit pruning. No sequence, migration-history privilege
or additional queue permission is needed.

PostgresIdempotencyStore borrows the native PgDatabase. run leases one READ COMMITTED
transaction and passes its managed executor to the business callback. The UPSERT
waits on the conflicting key and takes row ownership, returning the winning
generation's result; it does not read an independent connection or infer ownership
from an application mutex. Expired replacement keeps that ownership through the
new business writes and response update. Queue publication uses the same exact
Database object and connection. Replays also perform a no-op key UPDATE.

PostgreSQL documents atomic UPSERT behavior and conflict handling under
[READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)
and [INSERT ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT).
LongHorn additionally proves the application algorithm against its owned native
server rather than relying on SQL text inspection.

Existing provider statement/lock/idle-transaction timeouts still apply. Database
errors propagate; statement failure rolls the transaction back even if caught.
Do input validation/network preparation before holding row ownership; callbacks
should contain short database work and local queue validation. External effects
cannot be rolled back and should be represented by committed jobs.

prune uses an expiry-filtered limited selection with FOR UPDATE SKIP LOCKED and a
DELETE in one statement. A replacement already holding the expired row is skipped.
[Native proofs](idempotency-testing.md) cover restricted-role process contention,
SIGKILL windows, same-key HTTP requests across two hosts, permission-failure rollback,
expiry replacement, pruning during a held replacement and restart replay. Existing
task/report/account native gates remain part of regression verification.
