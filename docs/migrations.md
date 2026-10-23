# Schema migrations

Owner: `@longhorn/database`. Connects application-owned schema definitions to a
[database transaction](database.md) during [lifecycle startup](lifecycle.md).
The initial runner uses SQLite-compatible metadata SQL and positional placeholders.
It rejects an explicitly PostgreSQL database. Use the separate
[PostgreSQL runner](postgres-migrations.md) for schema-qualified metadata, native
parameters and transaction-scoped advisory locking; it does not translate SQLite DDL.

```ts
import { migrate } from '@longhorn/database'

const applied = await migrate(database, [{
  id: '001_items',
  statements: ['CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'],
}, {
  id: '002_items_index',
  statements: ['CREATE INDEX items_name ON items (name)'],
}])
```

Migrations are an ordered list of unique, nonempty IDs and SQL statement lists.
The caller supplies SQL directly; the shared package does not read a migrations
directory. Add new migrations at the end. Do not edit, remove, or reorder applied
migrations. Do not include manual BEGIN/COMMIT/ROLLBACK statements.

`migrate` computes SHA-256 checksums from statement lists using Web Crypto before
opening its write transaction. Inside that transaction it creates/reads
`longhorn_migrations`, verifies that applied rows form an unchanged ordered prefix,
runs pending SQL, and records each ID, position, checksum, and application timestamp.
It returns IDs applied by that invocation; a repeat invocation returns an empty list.

All pending statements and metadata share one transaction. A failed statement rolls
back that invocation, including earlier pending migrations. Already committed
migrations remain applied. Changed checksums, unavailable applied migrations, or
reordered prefixes stop startup rather than silently rewriting history.

The [SQLite adapter](sqlite.md) supplies write transactions and coordinates local
handles; SQLite provides locks between processes. Concurrent startup against the same
file must complete within the configured busy timeout. No distributed lock service,
down migrations, SQL rewriting, or automatic destructive schema repair is provided.

The [tasks schema](../examples/basic/src/sqlite-tasks.ts) owns its migration and row
mapping. [Storage startup](../examples/basic/src/storage.ts) completes migrations
before registering ready repositories and before the HTTP listener binds.

Verification: [SQLite migration tests](../runtimes/node/src/sqlite.test.ts) cover
repeat/concurrent application, checksum and ordering rejection, and atomic rollback.
The [process verification](../scripts/verify-persistence.mjs) restarts the executable
and checks that its migration is recorded exactly once.

The same coordinator also runs on [Durable Object SQLite](workers-durable-sqlite.md).
Its complete schema history is private to one Object ID and remains distinct from
Cloudflare class deployment migrations. See [Object schema history](durable-sqlite-migrations.md)
and [native DDL/history rollback proofs](workers-durable-testing.md).
