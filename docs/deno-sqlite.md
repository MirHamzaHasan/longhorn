# Native Deno SQLite provider

Owner: `@longhorn/deno/sqlite`. Implements the existing [Database](database.md)
contract with Deno's built-in `node:sqlite`, independently of the Node libSQL adapter.
The optional entrypoint contains filesystem and async-context imports; the Deno
HTTP entrypoint and shared packages do not import the native driver.

```ts
import { openSqlite } from '@longhorn/deno/sqlite'

const database = await openSqlite({ filename: './data/app.sqlite' })
try {
  await database.execute('CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, title TEXT)')
  await database.transaction(async tx => {
    await tx.execute({ sql: 'INSERT INTO items(title) VALUES(?)', args: ['LongHorn'] })
  })
} finally { await database.close() }
```

Deno 2.9.6 is the verified host; this optional entrypoint is not a Node 20 driver.
Grant read/write access to the chosen data directory for files and SQLite sidecars.
The in-memory variant needs no filesystem permission.

Local paths resolve against the process directory, parent directories are created,
and `:memory:` creates a private temporary database. Spaces, Unicode and `#` are
literal path characters. The adapter checks exact parameter arity and reads integers as bigint. Native
construction disables extension loading and double-quoted string literals. Startup enables foreign keys, WAL, synchronous FULL and a busy timeout.
Use local storage; the provider adds no remote service, replication or credentials.

## Inputs, results and limits

Inputs use one [SQLite statement](sqlite-statement-boundary.md) and positional binds.
SQL, argument arrays and blobs are copied before queued work. The
[binding planner](deno-sqlite-bindings.md) preserves named/numbered slot identity
without rewriting SQL. Booleans bind as
integer 1/0; safe integer numbers also bind as int64. Bigints must fit signed int64; numbers must be finite, and integer
numbers must be safe. Text inputs reject lone surrogates; SQL also rejects NUL.
Missing/extra binds reject before stepping the statement. Alias duplicate output
column names explicitly; native row objects cannot retain duplicate names.

Integer results are bigint, real results are number and blobs are copied Uint8Array.
Map IDs to strings before JSON. `rowsAffected` uses the statement's direct SQLite
change count when total connection changes advance, and zero otherwise. Trigger and
cascade effects are excluded; SELECT does not inherit the preceding write's count.
`lastInsertId` is connection metadata and may retain an earlier insertion's ID on
reads/updates. Prefer INSERT RETURNING for authoritative generated values.

| Option | Default | Allowed range |
| --- | --- | --- |
| busyTimeoutMs | 5000 | 0–60000 |
| maxPending | 64 | 1–10000 accepted root operations per handle |
| maxSqlBytes | 65536 | 1–1048576 UTF-8 bytes |
| maxInputBytes | 1048576 | 1–16777216 bytes across SQL and arguments |
| maxResultRows | 1000 | 1–100000 |
| maxResultBytes | 1048576 | 1–16777216 bytes across column names and values |

There are at most 1000 arguments and 1000 columns per row. Scalars are charged as
8 bytes for numbers/bigints, 1 for null, UTF-8 bytes for strings and actual blob
bytes. Limits bound accepted input and decoded output, not SQLite execution time
or native memory. Deno materializes `all()` before result checks. An autocommitted
write can therefore persist even when oversized output rejects. An uncaught result
error inside a callback rolls back that transaction. Never retry a mutating query
solely because its promise rejected.

## Lifetime and diagnostics

SQL execution is synchronous. The promise facade coordinates lifetime; expensive
queries and busy waits block Deno's event loop. Cross-process locking uses SQLite's
busy timeout without automatic query retry. [Async ownership](deno-sqlite-transactions.md)
coordinates same-file handles in this process.

`close()` stops root admission, drains this handle's accepted work, then closes the
native connection and releases its native statements. Repeated close returns its same
promise. It does not delete files or promise removal of WAL sidecars. Other open
handles keep their own lifetime. `stats()` returns pending accepted operations,
accepted operation/failure totals and closing/closed flags; startup counts as one
operation, and pre-admission input/capacity/closed errors are outside those totals.

`DenoSqliteError.code` is input, open, storage, protocol, result-limit, capacity,
closed or transaction. Native diagnostics are replaced with these fixed messages;
SQL, bound values, native error codes and filenames are not attached. Application
callback errors retain their identity. Rollback failure combines the application
error with a sanitized storage error. There is no timeout that releases a live
native operation behind the caller.

Connects to [migrations](migrations.md), [transaction publishers](deno-sqlite-transactions.md),
the [Deno task host](deno-sqlite-tasks.md) and [native verification](deno-sqlite-testing.md).
Native calls use [Deno's SQLite API](https://docs.deno.com/api/node/sqlite/).
