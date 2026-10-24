# Database contracts

Owner: `@longhorn/database`. Connects [runtime adapters](runtimes.md) to application
repositories without importing native drivers, filesystem APIs, or a schema vendor.
Concrete implementations are [Node SQLite](sqlite.md), [Node PostgreSQL](postgres.md)
and [Durable Object SQLite](workers-durable-sqlite.md).
The optional [D1 provider](workers-d1.md) implements the separate
[BatchDatabase capability](batch-database.md), using the same statements/results
without promising callback transactions.

## API

`Database` exposes `execute(statement)`, `transaction(work)`, and idempotent `close()`.
`SqlExecutor` exposes execute and an optional readonly dialect marker; transaction
callbacks receive this narrower API. Built-in adapters mark sqlite/postgres, while
older custom executors may omit it. SQL syntax/parameters remain native.

```ts
const result = await database.execute({
  sql: 'SELECT id, title FROM tasks WHERE id = ?',
  args: [id],
})

await database.transaction(async (tx) => {
  await tx.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['first'] })
  await tx.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['second'] })
})
```

Statements are SQL strings or `{ sql, args }` objects with positional values.
Use bound arguments for data. SQL dialect and placeholder syntax belong to the
selected adapter; these examples use SQLite's `?` syntax. This is a driver boundary,
not an ORM or a dialect translator.

Results contain `rows`, `rowsAffected`, and `lastInsertId`. Rows are named column
records. Values are strings, numbers, bigint, boolean, null, or `Uint8Array`. The SQLite
adapter returns integer columns as bigint to preserve precision. Convert IDs and
application values before returning JSON. Alias duplicate result column names to
avoid collisions. Application repositories validate and map rows to domain objects.

## Transactions and ownership

The adapter commits when an async callback succeeds and rolls back when it throws.
Use the callback's executor and await its operations; do not issue transaction-control
SQL manually or retain the executor after completion. Nested transactions are not
part of this contract. Driver errors propagate for the application's HTTP/logging
policy to handle.

Acquire connections in [lifecycle startup](lifecycle.md), register application-owned
[DI providers](dependency-injection.md), and return `database.close` as resource
cleanup. Core does not depend on a database package or open connections itself.
[Migrations](migrations.md) apply schema changes before listeners start.

The example's explicit chain is `TaskDatabase -> TasksStore -> TasksService -> HTTP`.
See [storage wiring](../examples/basic/src/storage.ts), the
[SQLite repository](../examples/basic/src/sqlite-tasks.ts), and [tasks](tasks-example.md).

## Verification and scope

[Adapter tests](../runtimes/node/src/sqlite.test.ts) exercise this contract with real
databases, including SQL values, rollback, close ordering, and concurrent handles.
[Application tests](../examples/basic/src/storage.test.ts) exercise SQLite through DI
and HTTP. `pnpm test:persistence` verifies built applications across separate processes.

SQLite and PostgreSQL are implemented. PostgreSQL keeps exact numeric/JSON/time/array
values as text and native booleans as boolean; SQLite boolean arguments bind as
integer 1/0. PostgreSQL has its own schema-history runner and an example migration
CLI. [PostgreSQL queues](queue-postgres.md) and [schedule dispatch](scheduler-postgres.md)
now use that transaction boundary too, as does [PostgreSQL auth](auth-postgres.md).
Query builders and additional providers remain future work. See provider guides for result/session behavior.

D1's predeclared native batches now have their own [schema runner](batch-migrations.md)
and [task integration](d1-tasks.md). A D1 handle is not a Database and cannot be
passed to existing callback-based SQLite/PostgreSQL stores. Native batch errors
roll back SQL; result conversion failures can occur after commit. Provider-specific
precision and lifetime policies remain explicit in [the guide](workers-d1.md).

Workers can borrow a SQLite-backed Durable Object through
`createDurableSqlite` from `@longhorn/workers/durable-sqlite`. The same migration,
SQLite queue and SQLite scheduler implementations run above it. Worker SQL returns
numbers and rejects unsafe integers; it cannot reproduce Node's bigint integer
mode. Input-gate/transaction ownership, admission and local-handle close differ
from a Node connection. See [provider](workers-durable-sqlite.md),
[transactions](durable-sqlite-transactions.md) and [native proofs](workers-durable-testing.md).

Built-in transaction callbacks now carry [managed executor provenance](transaction-executors.md).
The public SqlExecutor shape stays compatible; provider-owned scopes privately
track exact database identity and accepted transaction work. They expire the
callback executor, join registered publishers, and only then permit native commit.
Custom providers can adopt the separate transactions entrypoint. See
[atomic job publishing](transaction-publishing.md) and [native proof](transaction-publishing-testing.md).

[Request idempotency](idempotency.md) opens a transaction through this contract and
passes its executor to business repositories and job publishers. Its SQL store
commits scope/key ownership and the replayable result with those writes; callers
must not nest another root transaction around it. Schema deployment and database
shutdown remain application-owned.
