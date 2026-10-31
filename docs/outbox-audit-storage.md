# Recovery audit schema, upgrades and privileges

Owner: outboxAuditMigrations from `@longhornjs/outbox/sqlite` and
postgresOutboxAuditMigrations from `@longhornjs/outbox/postgres`. Connects
[recovery migrations](outbox-recovery-migrations.md), [audit API](outbox-audit.md),
[history](outbox-audit-history.md) and [retention](outbox-audit-retention.md).

Append longhorn_outbox/003_audit after the application's complete deployed history.
Earlier base/recovery lists and deployed SQL remain unchanged. The Worker example
appends it after its existing command/recovery prefix. Native QA seeds that prior
history and real failed delivery, then starts the upgraded compiled app.

SQLite/Object SQL stores rows in longhorn_outbox_recovery_audit (STRICT).
PostgreSQL uses longhorn_outbox.recovery_audit in a dedicated schema with PUBLIC
access revoked. Both use primary key (queue,id), safe integer millisecond times,
bounded identifier lengths, constrained outcomes/state/failure categories and
consistent nullable result fields. A scheduled row must describe pending state
and the granted ceiling. Two indexes support queue/time/ID history and
queue/delivery/time/ID history. There is no delivery foreign key: records survive
delivery cleanup and can describe missing targets.

An audited PostgreSQL runtime needs the existing queue SELECT/UPDATE plus:

```sql
GRANT USAGE ON SCHEMA longhorn_outbox TO your_app;
GRANT SELECT, INSERT ON TABLE longhorn_outbox.recovery_audit TO your_app;
```

No audit UPDATE/DELETE or DDL is required for append/history. Missing INSERT fails
the whole retry transaction; there is no silent logging failure. Separate trusted
maintenance can receive schema USAGE and table SELECT/DELETE for bounded retention.
The native gate proves those minimal maintenance privileges without audit UPDATE
or queue mutation permissions. PostgreSQL documents separate object privileges in
[GRANT](https://www.postgresql.org/docs/18/sql-grant.html).

Schema ownership/role grants remain deployment-owned; the migration does not create
login roles or grant arbitrary application users access. Ordinary staging/retry
paths do not require the audit feature until the application opts into audited
calls. Database owners can alter records; this is a durable application trail,
not a cryptographically tamper-evident ledger or database-owner security boundary.
