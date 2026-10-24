# Separate command budget maintenance authority

Owners: [access check](../examples/postgres/src/limit-maintenance-access.ts),
[transactional grants](../examples/postgres/src/limit-maintenance-grants.ts) and
[provisioning entrypoint](../examples/postgres/src/provision-limit-maintenance.ts).
Connects [expiry authority](rate-limit-cleanup-retention.md), [tool](command-limit-maintenance.md)
and [native negative checks](command-limit-maintenance-testing.md).

Deploy the complete existing operations migration profile first. A trusted cluster
administrator creates a separate login role with a private generated password and
CONNECT on the selected application database. For example, replace the database
name/password before running the administrative SQL:

```sql
CREATE ROLE longhorn_limit_maintenance LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'replace-with-private-generated-password';
GRANT CONNECT ON DATABASE your_app TO longhorn_limit_maintenance;
```

Then use the existing table/schema owner identity to grant the bounded tool's
profile. Owner credentials belong only in this explicit provisioning process:

```sh
# Workspace, with MIGRATION_DATABASE_URL in this process environment:
pnpm provision:command-limit-maintenance longhorn_limit_maintenance
# Generated/archived app:
pnpm provision:limit-maintenance longhorn_limit_maintenance
```

The helper does not create roles or alter migrations. One transaction grants schema
USAGE, table SELECT/DELETE and UPDATE(claim), then verifies the target profile.
Failure rolls back its new grants; it does not remove an existing excess grant or
repair the role. Invalid role names are rejected before the grant transaction.
The HTTP runtime retains SELECT/INSERT/UPDATE and no DELETE. Attempting to provision
that runtime as maintenance fails and leaves its previous grants intact.

The read-only startup check requires the actual bucket table, expected column
types/nullability and disabled RLS, plus the required effective permissions. It
rejects administrative flags, bucket/schema ownership, database CREATE, CREATE
on public/known app schemas, ability to SET another role, bucket INSERT/TRUNCATE/
REFERENCES/TRIGGER, UPDATE on columns other than claim, and table/column data
privileges in the known business/auth/queue/replay/outbox/scheduler schemas.

The column UPDATE grant enables PostgreSQL's locking SELECT; the pruning query
does not update claim. [PostgreSQL's SELECT documentation](https://www.postgresql.org/docs/18/sql-select.html)
records that locking privilege requirement. DELETE credentials remain trusted and
could delete live rows outside the tool. This profile check is not a whole-cluster
privilege audit or an owner migration-checksum verifier; owner deployment retains
those responsibilities. No automatic grants occur in check/once/watch, and no
business-data SELECT is required for this metadata check.
