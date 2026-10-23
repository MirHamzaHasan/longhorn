# PostgreSQL migration and runtime roles

Owner: application deployment; demonstrated by scripts/postgres-sandbox.mjs.
Connects [migrations](postgres-migrations.md), [provider connections](postgres.md)
and [HTTP persistence](postgres-example.md).

The provider uses the credentials supplied by the host; it does not downgrade a
superuser automatically. Keep migration DDL and routine application queries on
separate nonsuperuser roles. The local demo/native gate creates an owned temporary
database with password authentication and these roles:

| Role | Purpose | Privileges |
| --- | --- | --- |
| longhorn_admin | Temporary cluster bootstrap only | Creates demo database/roles; never used by HTTP |
| longhorn_owner | Schema/migration deployment | Owns the temporary database/schema/table/identity sequence |
| longhorn_app | HTTP/background runtime | CONNECT/schema USAGE, task DML, identity sequences, queue/schedule DML, report insertion, credential/session/throttle operations and scoped note operations |

The runtime has no superuser, database creation, role creation, schema DDL or migration
metadata privileges. Default public database/schema access is revoked in the owned
demo. This is not a script to apply automatically to an existing organization database.

For a database/roles you provision, deploy the schema with MIGRATION_DATABASE_URL,
then grant the intended runtime role its specific resources, for example:

```sql
GRANT CONNECT ON DATABASE your_database TO your_app;
GRANT USAGE ON SCHEMA longhorn_pg_example TO your_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE longhorn_pg_example.tasks TO your_app;
GRANT USAGE ON SEQUENCE longhorn_pg_example.tasks_id_seq TO your_app;
GRANT USAGE ON SCHEMA longhorn_queue, longhorn_scheduler TO your_app;
GRANT SELECT, INSERT, UPDATE ON TABLE longhorn_queue.jobs, longhorn_scheduler.schedules TO your_app;
GRANT SELECT, INSERT ON TABLE longhorn_pg_example.task_reports TO your_app;
GRANT USAGE ON SCHEMA longhorn_auth TO your_app;
GRANT SELECT, INSERT ON TABLE longhorn_auth.users TO your_app;
GRANT SELECT, INSERT, DELETE ON TABLE longhorn_auth.sessions TO your_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE longhorn_auth.attempts TO your_app;
GRANT SELECT, INSERT, DELETE ON TABLE longhorn_pg_example.private_notes TO your_app;
GRANT USAGE ON SEQUENCE longhorn_pg_example.private_notes_id_seq TO your_app;
GRANT USAGE ON SCHEMA longhorn_idempotency TO your_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE longhorn_idempotency.requests TO your_app;
```

Role/database creation and passwords belong to your deployment process. The migration
CLI uses its supplied owner role and does not create application login roles or grant
arbitrary users access. The demo's random passwords stay in process environment and
its temporary password file, never command-line arguments or printed URLs. Native
bootstrap SQL only interpolates generated hexadecimal passwords/static identifiers.

Public tasks/reports share one dataset. The [account sub-app](postgres-accounts.md)
adds PostgreSQL credentials/sessions and [private notes](postgres-private-notes.md)
with explicit principal-derived owner filters, not RLS. Queue/scheduler DELETE,
report UPDATE/DELETE, user UPDATE/DELETE, session UPDATE and note UPDATE remain denied.
Trusted server credentials span accounts; they are never supplied to browser clients.
The optional [operations profile](operator-provisioning.md) adds trusted role tooling
and a narrow [transaction-auth function](postgres-transaction-auth.md) EXECUTE grant.
It preserves runtime user UPDATE denial and uses a separate provisioning connection.
PostgreSQL connectivity does not make existing SQLite SQL portable.

[Request idempotency](idempotency-postgres.md) adds only its dedicated ledger DML.
Its no-op UPSERT needs UPDATE/SELECT as well as INSERT; explicit bounded cleanup
uses DELETE. The runtime still cannot alter/drop the ledger or read migration
history. Result scopes/authorization belong to the application, as with tasks.

Native tests confirm the runtime identity is nonsuperuser, DML works, DDL/history
reads fail with 42501, and incorrect passwords fail with 28P01 on the actual server.
