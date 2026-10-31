# PostgreSQL queue storage

Owner: `@longhornjs/queue/postgres`. Connects the existing [Queue contract](queues.md),
[workers](queue-workers.md), [PostgreSQL database](postgres.md), [migrations](postgres-migrations.md),
and [task reports](postgres-reports.md). This entrypoint imports no native driver;
the host supplies a PostgreSQL Database, normally from @longhornjs/node/postgres.

```ts
import { migratePostgres } from '@longhornjs/database/postgres'
import { PostgresQueueStore, postgresQueueMigrations } from '@longhornjs/queue/postgres'

// Deployment uses the owner connection and the application's complete ordered history.
await migratePostgres(owner, [...existingMigrations, ...postgresQueueMigrations], { schema: 'app_history' })
const store = new PostgresQueueStore(runtimeDatabase)
// Supply store to Queue({ name, schema, store }); Queue/QueueWorker APIs are unchanged.
```

The migration creates fixed schema longhorn_queue and table jobs, with a composite
(queue,id) primary key, state/lease/attempt constraints and partial indexes for pending
and expired running jobs. Append these migrations once to one authoritative history;
do not initialize the same tables through competing histories. Never edit a deployed
migration. The store borrows the database and never migrates or closes it.

Payloads are exact serialized text. Timestamps/deadlines are bigint milliseconds,
converted to safe integer numbers at the provider boundary. Attempts are limited to
1–100 by Queue/schema. Queue remains responsible for schema/JSON/size/clock validation.
Low-level QueueStore inputs are trusted coordinator data. A known non-PostgreSQL
dialect is rejected before SQL; missing dialect metadata supports custom executors.

Each claim uses a short READ COMMITTED transaction. First it locks/reclaims at most
100 expired jobs with FOR UPDATE SKIP LOCKED, returning attempts with budget left to
pending and marking exhausted attempts failed. It then locks the oldest available
unlocked pending job and atomically assigns a fresh token/deadline while incrementing
attempts. Locks end before handler work begins. Delays and retry times use supplied
coordinator time. Recovery is incremental on claims, not reads; an idle result can
occur while work is locked elsewhere or after an exhausted recovery batch.

Completion, failure and renewal require the queue, ID, matching token, running state,
and lease_until greater than the supplied time. Renewal never shortens a deadline.
Concurrent updates recheck ownership after waiting for their row lock. Lost owners
cannot acknowledge a replacement lease. Workers need synchronized clocks and lease
settings appropriate to latency. Available-row ordering is not a global FIFO or
fairness guarantee under concurrent locks.

Execution remains at-least-once. A committed domain effect may precede a lost
acknowledgement; use context.id for idempotency. insertPostgresJob(executor,input)
allows a validated PreparedJob plus ID/timestamps to join caller-owned SQL transactions.
It does not validate payloads or provide a business outbox dispatcher automatically.
Queue.enqueue always creates independent work with a new ID.

Grant runtime schema USAGE and jobs SELECT/INSERT/UPDATE. The framework needs no
DELETE, sequence or DDL privileges. Jobs are retained; purging, admin replay, LISTEN
wakeups, priorities, pooler/failover behavior and tenant authorization are separate work.
See [native background verification](postgres-background-testing.md). The locking
approach follows [PostgreSQL SELECT locking](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE).

The store now implements enqueueInTransaction for an original managed executor
belonging to its exact Database instance. Applications use the
[typed publishing helper](postgres-transaction-publishing.md) for schema/limit
validation and accepted-work drain. It shares the existing business transaction
and adds no table or nested transaction. See [task/report HTTP](task-report-transactions.md)
and [native visibility/crash proof](transaction-publishing-testing.md).
