# PostgreSQL migrations

Owner: `@longhornjs/database/postgres` (`migratePostgres`). Connects [SQL transactions](postgres-transactions.md),
[the Node provider](postgres.md), [roles](postgres-roles.md) and [the example](postgres-example.md).
The helper imports no Node driver; it requires PostgreSQL transaction/SQL semantics.

```ts
const added = await migratePostgres(database, [{
  id: 'app/001_items',
  statements: ['CREATE TABLE app_data.items (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text NOT NULL)'],
}], { schema: 'app_data' })
```

One explicit schema owns one complete ordered history (default longhorn). Schema
names are lowercase ASCII identifiers up to 63 characters; pg_ names and
information_schema are rejected. The helper quotes the identifier and schema-qualifies
its longhorn_migrations table. Application migration SQL remains explicit; the schema
option does not rewrite statements or change their search_path.

Definitions are snapshotted and checksummed before starting a transaction. IDs must
be unique/nonempty and statements nonempty SQL strings. SHA-256 hashes preserve the
exact statement-list text. The runner obtains a deterministic signed-64-bit transaction
advisory lock for the namespace **before schema/table creation**, then creates/reads
metadata, checks the unchanged ordered prefix, applies pending statements and records
positions/checksums/timestamptz application times. Repeated runs return no new IDs.

The transaction-scoped lock coordinates cooperating processes, including first startup.
It releases on commit/rollback/disconnection; no session lock survives pooling.
Different namespaces have separate histories/keys. Hash collisions can serialize
unrelated namespaces but do not mix metadata. The server's lock timeout bounds waits.
See [PostgreSQL advisory locking](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

All pending DDL/data/metadata commits together. A failed statement or killed process
rolls back the invocation, including a newly created schema/history. Existing committed
history remains. Changed checksums, missing applied entries and reordered prefixes
reject without rewriting history. Transactional migrations cannot contain commands
requiring an external transaction boundary, such as CREATE INDEX CONCURRENTLY, or
manual transaction-control SQL. Supply separate deployment procedures when needed.

Use a migration owner with the required schema/database DDL privileges. Runtime
credentials need not read or modify migration history. The example has a separate
migrate command; its HTTP process never migrates. Existing migrate() remains the
SQLite-compatible runner and rejects a known PostgreSQL dialect; this entrypoint
rejects a known SQLite dialect. SQL is not translated between providers.

Native tests verify first-run concurrency, checksum/history rejection and failed-DDL
rollback. Separate actual processes race on initial schema creation; another is
SIGKILLed after DDL but before metadata insert, then recovery applies exactly once.
See [the native gate](postgres-local.md).

The task app's complete history now appends [idempotency storage](idempotency-postgres.md)
after deployed task/report/account/private-note prefixes. Existing migration SQL
is unchanged. Deploy the appended schema with the owner and apply its explicit
runtime ledger grants before starting the upgraded app.
