# Separate maintenance role

A cluster administrator must create a separate non-admin login with a private
generated password, NOINHERIT and CONNECT on the selected application database.
Do not reuse the HTTP runtime or schema owner. Then, with MIGRATION_DATABASE_URL
only in this provisioning process, run:

```sh
pnpm provision:limit-maintenance your_maintenance_role
```

This tool grants schema USAGE, bucket SELECT/DELETE and UPDATE(claim) in one
transaction, checks the resulting profile and rolls back new grants on failure.
It creates no role, schema or table and does not remove existing excess privileges.
The column UPDATE grant permits the existing locking SELECT; the prune query does
not change claim. DELETE remains trusted authority that could remove live rows
outside this API. Put its private URL only in the [maintenance configuration](limit-maintenance.md).

Startup checks expected bucket column types/nullability and disabled RLS. They
reject administrative flags, ownership/database DDL, public/known app schema DDL,
role delegation, extra bucket mutation privileges and table/column data rights in
known business/auth/queue/replay/outbox/scheduler schemas. This is a targeted
profile check, not an owner migration-history or whole-cluster privilege audit.
Owner deployment and the HTTP runtime's existing no-DELETE role stay unchanged.
