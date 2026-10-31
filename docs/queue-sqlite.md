# SQLite queue storage

Owner: `@longhornjs/queue/sqlite`. Connects [queue contracts](queues.md) to
[database transactions](database.md), [migrations](migrations.md), and
[Node SQLite](sqlite.md) or [Durable Object SQLite](workers-durable-sqlite.md).
It imports portable SQL types, not a Node driver.

```ts
import { queueMigrations, SqliteQueueStore } from '@longhornjs/queue/sqlite'
await migrate(database, [...existingApplicationMigrations, ...queueMigrations])
const store = new SqliteQueueStore(database)
```

Compose migrations into one complete, stable ordered history per database.
Append queue migrations after an existing deployed prefix; never edit or reorder
applied entries. A standalone database can use just queueMigrations. The
[report app](jobs-example.md) has its own file/history and appends its result table.
The task/auth examples' migration histories and data are independent.

`longhorn_queue_jobs` stores a composite queue/ID primary key, JSON string payload,
state, attempts/budget, ready/creation/update times, lease token/deadline, and a
bounded failure category. STRICT tables and checks constrain states, attempt budgets,
and lease consistency. Partial indexes support due pending jobs and expired leases
within a queue. Successful/failed payloads remain on disk until application-owned
retention tooling removes them; there is no built-in cleanup or encryption layer.

A SQLite **write transaction** recovers that queue's expired running jobs, selects
its first due pending row, and increments attempts/assigns a token before commit.
SQLite serializes writers across connections and processes. complete/fail/renew
use conditional updates checking queue, ID, running state, token, and lease deadline
against the supplied current time. A stale owner cannot mutate a replacement lease.
Renewal never shortens an existing deadline. Operations resolve after their write
has committed, or reject as a provider error through Queue.

The store borrows the Database. Migrations and database close belong to the app.
The entrypoint also exports insertSqliteJob(executor, input), which accepts an
existing SqlExecutor/transaction and trusted NewJob metadata. It validates neither
schema nor coordinator options and commits nothing itself. Queue.prepare supplies
validated serialized payloads; integrations must supply valid IDs/times and own the
transaction. The [scheduler provider](scheduler-sqlite.md) uses this primitive to
pair queue insertion with durable cursor advancement, without nested transactions.
Use `@longhornjs/node/sqlite` for the verified local driver: WAL, FULL synchronous
mode, write transactions, foreign keys and a busy timeout. Do not use this SQL
adapter with a provider lacking SQLite syntax/transaction guarantees. No Redis,
Postgres, remote SQLite, or platform queue provider is implemented here.

Clocks are supplied by each coordinator and must be synchronized. Tokens fence
queue-state changes rather than external effects; see [delivery limits](queues.md).
Recovery is claim-driven, not a timer: start a consumer to reclaim abandoned work
or terminally mark an exhausted expired attempt. Multiple processes share a file
on the same supported local filesystem; cross-machine shared-filesystem locking
and high-volume scaling are outside this provider's verified boundary.

`examples/jobs/src/store.test.ts` covers the storage contract and migration replay.
`pnpm test:queues` checks two actual consumers, one persisted effect per job,
SIGKILL recovery/exhaustion, long-handler heartbeats, SQLite integrity, and restart.

`@longhornjs/workers/durable-sqlite` also supplies a verified SQLite transaction
boundary, using Object SQL/input gates rather than Node file settings. The same
store persists queue state privately per Object ID. `pnpm test:worker-storage`
proves native claims/renewal/expiry/fencing, pending jobs across workerd restart
and report effects. See [Worker queue ownership](workers-durable-queues.md) and
[native proofs](workers-durable-testing.md). This does not implement a Cloudflare
Queues broker subscription or cross-Object transaction.

Application code can now use [typed transaction publishing](sqlite-transaction-publishing.md)
instead of assembling trusted NewJob metadata. The store's enqueueInTransaction
capability checks the exact active database scope; the public helper owns queue
validation and accepted publisher drain. No migration or implicit nested transaction
is added. Native tests prove business/job visibility and SIGKILL behavior together.
