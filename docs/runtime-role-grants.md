# Trusted runtime grant provisioning

Owner: `examples/postgres/src/runtime-grants.ts` and the archive's
scripts/provision-runtime.mjs. Connects [deployment](command-app-deployment.md),
[restricted roles](postgres-roles.md) and [transaction authentication](postgres-transaction-auth.md).

grantOperatorRuntime(database,role) is a trusted deployment function over a borrowed
database. It validates a simple lowercase identifier of at most 63 characters,
rejects pg_ names, requires an existing nonadministrative role, then adds the
application's explicit grants in one managed transaction. The quoted target is
derived only from that validated identifier. It never interpolates passwords.

The table grants cover tasks/reports, queue/scheduler, account/session/attempt/note,
idempotency, command history and recovery audit resources. It grants the existing
transaction-auth function EXECUTE while preserving the migration's PUBLIC revoke.
The appended [password capability](postgres-password-changes.md) adds only its two
function EXECUTE grants. Direct password/role UPDATE remains forbidden.
Runtime user UPDATE, audit mutation, migration metadata and queue maintenance
DELETE remain excluded. The history identity is GENERATED ALWAYS and requires no
additional runtime sequence grant for ordinary inserts.

The archive runs this after migrations with `pnpm provision:runtime ROLE` from a
separate owner shell. Database CONNECT and login creation/passwords remain external.
The function adds grants and does not remove existing excess authority; the HTTP
host verifies its effective role and refuses excessive privileges before listening.
No provisioning endpoint or owner credential is added to HTTP.

[Native distribution verification](command-app-testing.md) proves an empty database
can start through these actual grants, invalid/administrative roles are rejected,
restored state works after regranting and user/audit mutation plus migration-history
reads remain denied.
