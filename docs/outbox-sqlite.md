# SQLite and Object SQL outbox records

Owner: `@longhornjs/outbox/sqlite`, SqliteOutboxStore and outboxMigrations. Connects
[SQLite queue storage](queue-sqlite.md), [transactions](sqlite-transaction-publishing.md),
[Object SQL](workers-durable-sqlite.md), [retention](outbox-retention.md) and
[alarm pipeline](outbox-worker-example.md).

SqliteOutboxStore extends the existing SQLite queue store and borrows its Database.
It requires an explicit sqlite dialect. Outgoing records remain in
longhorn_queue_jobs under the Outbox's prefixed queue name. Append queueMigrations
and then outboxMigrations to one complete application history, preserving deployed
prefixes. The outbox migration adds a partial terminal-record index on
(queue,updated_at,id); it does not change existing queue schemas or records.

enqueueInTransaction uses the same exact Database handle's managed executor, so
validation/insert work joins before commit and rejects unsafe/foreign/expired
scopes. Native Node write transactions serialize across processes. Independent
readers do not see the business row or staged message before commit. Queue claims
commit a lease before any publisher network call, keeping transactions short.

In a SQLite-backed Durable Object, the same store runs through the Object provider.
When its existing SQL alarm host lists the outgoing queue, business/message/request
writes and the projected wakeup commit atomically. Publisher calls occur after
the claim transaction releases native ownership. A reset after broker acceptance
leaves the running lease; a later alarm retries the same message ID.

Terminal cleanup is one limited native DELETE, always scoped to the exact Outbox
queue. Pending/running rows are excluded; failed rows require an explicit option.
SQLite serializes cleanup with native writers. The store owns no connection,
migration runner or timer. [Native verification](outbox-testing.md) proves on-disk
process visibility/SIGKILL and actual Object SQL/alarm reset/restart paths.

The store also implements [bounded inspection](outbox-inspection.md) and
[conditional retry](outbox-deliberate-retry.md). Append the separate
[recovery index history](outbox-recovery-migrations.md) after deployed application
migrations. A failed-to-pending UPDATE and Object alarm projection commit together;
[native recovery QA](outbox-recovery-testing.md) verifies rollback and redelivery.
