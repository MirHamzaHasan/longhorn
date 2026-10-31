# Node SQLite adapter and persistent tasks

Owner: `@longhornjs/node/sqlite`. Uses the local SQLite entrypoint of
[`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts) and implements
the [runtime-neutral database contract](database.md). Native driver and filesystem
imports stay inside this Node-specific entrypoint; importing shared core or the
Node HTTP adapter does not import this SQLite module.
For Bun's native driver, use the separate [Bun SQLite entrypoint](bun-sqlite.md)
with its own synchronous-execution and async-lifetime policy.
The adapter marks its executor/connection dialect as sqlite. Portable boolean
arguments bind as integer bigint 1/0; PostgreSQL retains native booleans through
its [separate provider](postgres.md). SQL/placeholder syntax is never rewritten.

## Open a connection

```ts
import { openSqlite } from '@longhornjs/node/sqlite'

const database = await openSqlite({ filename: './data/app.sqlite', busyTimeoutMs: 5000 })
try {
  await database.execute('CREATE TABLE IF NOT EXISTS items (name TEXT NOT NULL)')
  await database.execute({ sql: 'INSERT INTO items VALUES (?)', args: ['LongHorn'] })
} finally {
  await database.close()
}
```

Parent directories are created automatically. Relative filenames use the process
working directory. `:memory:` creates an isolated temporary database. Only local
filenames are accepted; this adapter does not connect to a hosted service or require
credentials. File URLs are constructed internally so spaces and special characters
in filenames are handled correctly.

Initialization enables foreign keys, WAL mode for file databases, `synchronous=FULL`,
and a busy timeout (default 5000 ms). These are [SQLite settings](https://www.sqlite.org/pragma.html),
not settings for other database dialects. See [SQLite's WAL documentation](https://www.sqlite.org/wal.html)
for its filesystem and locking model. Use a local filesystem; WAL is not a
cross-machine shared-filesystem deployment strategy.

## Concurrency and cleanup

Operations are serialized, including complete transaction callbacks. Handles opened
through this adapter for the same canonical file share an in-process queue. Integer
columns use bigint; blobs become `Uint8Array`. The driver uses one native connection
per handle so per-connection initialization remains consistent.

SQLite handles coordination with other processes. Contention can still return a busy
error if another process holds a write transaction beyond the configured timeout.
Keep callbacks short and do not wait for unrelated external work while holding a
write transaction. The adapter is not a distributed database or a high-throughput
connection-pool abstraction.

Calling the parent database from inside its transaction callback rejects rather
than deadlocking; use the supplied executor. That executor rejects after completion.
Closing waits for accepted operations, rejects new work, and is idempotent. A failing
operation does not prevent later accepted work or cleanup.

## Example wiring

The executable tasks app uses SQLite by default. `DATABASE_PATH` defaults to
`./data/longhorn.sqlite`, resolved relative to `examples/basic/` in source and built
execution. Configure it through [.env](configuration.md), or use an absolute path.
`DATABASE_PATH=:memory:` is an explicit nonpersistent option.

[storage.ts](../examples/basic/src/storage.ts) opens the database and runs
[migrations](migrations.md) in a startup hook, then registers `TaskDatabase` and the
dependent `TasksStoreToken` provider. The service resolves that store and all CRUD
methods are async. A failed migration or provider registration closes the partially
acquired database. A failed listener bind also releases it through lifecycle rollback.
Normal shutdown drains requests before closing the database.

Tasks use a SQLite-generated autoincrementing ID. User values are bound parameters;
updates and deletes operate on IDs without interpolating SQL. The repository maps
integer completion values and bigint IDs into JSON-safe domain objects. Committed
creates, updates, deletions, and ID allocation survive process restarts.

The [memory implementation](../examples/basic/src/test-support.ts) is an explicit
test fixture. `createApp()` does not silently choose memory storage; callers either
configure SQLite startup or supply their own `TasksStore`.

## Verification

- [Native adapter tests](../runtimes/node/src/sqlite.test.ts): SQL values, rollback,
  foreign keys, concurrent handles, transaction lifetime, migrations, and close ordering.
- [Application storage tests](../examples/basic/src/storage.test.ts): reopened apps,
  concurrent real HTTP creates, parameterized values, durable deletion, and bind cleanup.
- `pnpm test:persistence`: builds the workspace and runs
  [separate-process verification](../scripts/verify-persistence.mjs), including two
  simultaneous writers, restart persistence, file format, migration count, and integrity.

These checks use temporary directories and do not modify the example's normal database.
