# Durable Object SQLite provider

Owner: `@longhorn/workers/durable-sqlite`. Connects a SQLite-backed Durable Object
to the existing [Database contract](database.md), [transactions](durable-sqlite-transactions.md),
[migrations](durable-sqlite-migrations.md), [queues](workers-durable-queues.md) and
[schedule storage](workers-durable-scheduler.md). It imports no Node driver.

```ts
import { createDurableSqlite } from '@longhorn/workers/durable-sqlite'

// Inside a SQLite-backed Durable Object, with its original state:
const database = createDurableSqlite(state, { maxPending: 64 })
const result = await database.execute({ sql: 'SELECT value FROM settings WHERE id = ?', args: [1] })
```

`DurableSqliteState` requires the original state's `blockConcurrencyWhile` and
storage's `sql`, `transaction`, and `sync` capabilities. A legacy KV-backed Object
does not supply the required SQL backend. Construct one handle per Object and use
it for the Object's whole database lifetime. The handle reports `dialect: 'sqlite'`.
`close()` drains accepted work and synchronizes writes; it does not close/delete
the platform-owned binding or install an eviction hook.

## Provider choice

LongHorn's callback transaction can read a row and choose later statements in one
atomic unit. Durable Object storage exposes a matching async transaction API and
private per-Object SQL storage. D1's batch API is a different boundary; this provider
does not pretend it implements a generic callback transaction. See the official
[Durable Object SQL/transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [D1 database methods](https://developers.cloudflare.com/d1/worker-api/d1-database/).
The [native gate](workers-durable-testing.md) verifies this choice on pinned workerd.

## SQL and values

Use bound positional arguments and one SQL statement per `execute` call. SQL
syntax, schema limits, authorizers and supported pragmas remain native to the
platform. LongHorn does not translate dialects or expose BEGIN/SAVEPOINT control;
use `database.transaction` instead. SQL batches are outside this result contract.

| Value | Provider behavior |
| --- | --- |
| `string`, `null` | Passed through |
| `boolean` argument | Bound as integer 1/0 |
| `number` | Finite values; unsafe integers rejected on bind and read |
| `bigint` argument | Converted only within JavaScript's safe integer range |
| `Uint8Array` argument | Copied to an ArrayBuffer at admission |
| SQL BLOB result | Copied to Uint8Array |
| SQL INTEGER/REAL result | Native number; no invented bigint precision |

Worker SQL returns numbers, unlike the Node SQLite adapter's bigint integer mode.
Use text encodings or another provider for exact integers outside the safe range.
Query rows are fully materialized before yielding. `rowsAffected` uses direct
SQLite changes after write activity; reads with no change in total_changes return
zero. `lastInsertId` reads the native last row ID through SQL text before
converting to bigint, preserving int64 precision (including initial 0n). It is not
a fresh ID guarantee for every statement and does not change numeric row decoding.
Alias duplicate column names yourself.

Input SQL/arguments are snapshotted at root admission. Result conversion runs
inside the native transaction: an unsafe returned integer rejects and rolls back
that statement's writes. Inside a callback, await executor operations and let
conversion/query errors escape to roll back the whole callback. Deliberately
catching an operation failure may let the callback commit other valid work.

See [the report example](workers-durable-example.md) for real bindings and
[native verification](workers-durable-testing.md) for persistence, rollback,
parameter snapshots and actual platform scalar behavior.

The optional [SQLite alarm clock](workers-sqlite-alarms.md) installs one internal
commit projection for this storage. Its private executor runs after a successful
root operation and before native commit, making SQL changes and native wakeups
atomic across all handles. Reads also reconcile while that clock is active.
Without a clock there is no alarm projection or schema requirement. See
[planning](alarm-wakeup-planning.md), [clock migration](alarm-migrations.md) and
[native interruption proof](workers-alarm-testing.md).

Transactions now carry [provider-owned executor scopes](transaction-executors.md)
for [typed job publishing](object-transaction-publishing.md). Accepted publishers
drain before the user scope expires and before the alarm commit projection runs.
The public callback executor is sealed as soon as the callback returns; admitted
participants have their own temporary executor until insertion completes. A failed
publication prevents commit, including after an application catches its rejection.
The business/job/alarm boundary is proved on [real Object SQL](transaction-publishing-testing.md).
