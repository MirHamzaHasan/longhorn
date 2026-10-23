# PostgreSQL outbox records and maintenance

Owner: `@longhorn/outbox/postgres`, PostgresOutboxStore and
postgresOutboxMigrations. Connects [PostgreSQL queues](queue-postgres.md),
[managed producers](postgres-transaction-publishing.md), [roles](postgres-roles.md),
[retention](outbox-retention.md) and [dispatching](outbox-dispatcher.md).

PostgresOutboxStore extends PostgresQueueStore and requires a postgres dialect.
Records use longhorn_queue.jobs with the Outbox's prefixed queue name. Append
postgresQueueMigrations before postgresOutboxMigrations in the application's one
complete owner history. The latter adds a partial terminal-record index and leaves
existing SQL/payload contracts unchanged. It is optional for applications that do
not use an Outbox; the tasks example does not acquire an unused outbox service.

The runtime's existing schema USAGE and queue SELECT/INSERT/UPDATE support staging,
claiming, retry/lease recovery and acknowledgement. No DDL or queue DELETE is needed
to deliver messages. Business writes and outgoing insertion share the caller's
leased connection. Network publication runs after the claim transaction, so a
slow broker does not hold business or queue-claim locks. Concurrent dispatchers
use the queue provider's FOR UPDATE SKIP LOCKED claims and fenced transitions.

prune requires DELETE on longhorn_queue.jobs in addition to SELECT/UPDATE used by
its limited locked selection. Use a trusted maintenance credential or an explicitly
chosen deployment grant. The demo/native runtime deliberately retains its existing
DELETE denial; the owned test uses a separate owner connection for cleanup. Since
the table also contains ordinary queues, a table DELETE grant spans them: the
library's queue filter is an application rule, not a database row-level policy.

Cleanup selects terminal rows ordered by updated_at/id with FOR UPDATE SKIP LOCKED
and deletes at most the requested limit in one statement. Pending/running rows
remain. [Native tests](outbox-testing.md) deploy the complete example history plus
the outbox index in an owned sandbox, then prove restricted-role producer/crash
recovery through a real workerd broker, stable-ID redelivery, one consumer effect,
runtime maintenance denial and bounded owner cleanup.

[Inspection](outbox-inspection.md) and [deliberate retry](outbox-deliberate-retry.md)
reuse existing SELECT/UPDATE grants. The separate
[recovery migration list](outbox-recovery-migrations.md) adds an index after the
complete deployed history. A conditional native UPDATE raises the matching failed
record's ceiling and returns explicit metadata. [Recovery proofs](outbox-recovery-testing.md)
cover independent processes, commit interruption and maintenance races.
