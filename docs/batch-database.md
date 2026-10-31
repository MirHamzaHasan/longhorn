# Atomic batch database capability

Owner: `BatchDatabase` in `@longhornjs/database`. Connects application repositories to
the [D1 provider](workers-d1.md), [batch migrations](batch-migrations.md) and shared
SQL values/results without adding platform imports to core.

`BatchDatabase` extends `SqlExecutor` with `batch(statements)` and `close()`.
The complete statement list is supplied before execution. Results correspond to
that list in order; a native SQL failure rolls back the batch. A provider must
implement one atomic operation, not a loop of separately committed execute calls.

```ts
import type { BatchDatabase } from '@longhornjs/database'

async function record(database: BatchDatabase, id: string) {
  return database.batch([
    { sql: 'INSERT INTO items(id) VALUES(?) RETURNING id', args: [id] },
    { sql: 'INSERT INTO activity(item_id) VALUES(?)', args: [id] },
  ])
}
```

This is a separate capability from [Database.transaction](database.md). It cannot
read a row into JavaScript and then choose later statements inside the same
transaction. Encode conditional changes and dependent writes in SQL, as the
[task repository](d1-tasks.md) does. Reading first and submitting a later batch
does not lock the earlier observation; use a conditional write or an explicit
guard inside the batch.
The separate [batch idempotency API](batch-idempotency.md) accepts a complete
business plan and known JSON response, preserving this same boundary.

The existing callback-based SQLite/PostgreSQL migrations, queue, scheduler, auth,
idempotency and outbox stores still require their existing providers. D1 cannot
be substituted for those stores by a type cast. No callback transaction or
managed transaction publisher is exposed by this capability.

The contract uses the existing `SqlStatement` and `QueryResult` types. SQL dialect,
value conversion, admission, result limits and close behavior belong to the
provider. Result decoding occurs after native execution: a decoding failure can
follow an already committed write. See the [D1 precision policy](workers-d1.md).
Native rollback and repository behavior are proved by [the D1 gate](d1-testing.md).
