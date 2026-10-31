# Outbox inspection indexes and upgrade ownership

Owner: outboxRecoveryMigrations from `@longhornjs/outbox/sqlite` and
postgresOutboxRecoveryMigrations from `@longhornjs/outbox/postgres`. Connects
[base storage](outbox-sqlite.md), [PostgreSQL storage](outbox-postgres.md),
[migration rules](migrations.md) and [inspection](outbox-inspection.md).

The new feature list contains longhorn_outbox/002_inspection. It adds an index on
(queue,state,created_at,id) to the existing job table, named longhorn_outbox_inspection
in SQLite and outbox_inspection in the PostgreSQL queue schema. This supports the
exact queue/state prefix and stable createdAt/ID page order. It also adds index
maintenance work to writes in that shared table. No payload, lease, state or retry
counter columns are added or reset.

The original outboxMigrations/postgresOutboxMigrations lists stay unchanged. Append
the recovery list after the application's complete deployed history, including any
application migrations that followed the base outbox index. Do not insert it before
those deployed application resources or run a shorter feature history independently.

The Worker example now owns its history in src/migrations.ts: deployed queue,
scheduler, alarm, request, base outbox and command resources remain the same prefix,
then the recovery index follows. Native QA creates the prior history and a failed
command/outgoing record, then starts the compiled upgraded app and checks the new
index history entry and preserved data.

Both built-in stores implement inspection/retry through the existing job table.
The index is an owner deployment/performance resource, not a new runtime permission
or a data-format requirement. Without it the SQL still executes, with potentially
more sorting/scanning. SQLite/Object apps own their complete migration history;
PostgreSQL owner credentials deploy the index before runtime startup.

Existing queue SELECT/UPDATE privileges cover metadata inspection and conditional
retry; INSERT covers ordinary staging. No new DDL/DELETE privilege is granted to
the runtime. Cleanup retains its separate maintenance requirement. Older custom
OutboxStore implementations can opt into OutboxRecoveryStore; ordinary enqueue,
dispatch and prune remain usable without that optional capability.

The newer [audit schema](outbox-audit-storage.md) is another separate append-only
feature list, after this recovery prefix. It requires explicit runtime append/read
grants in PostgreSQL and does not silently change the ordinary retry contract.
