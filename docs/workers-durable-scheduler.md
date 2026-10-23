# Durable Worker schedule storage and triggers

Owner: existing `@longhorn/scheduler/sqlite` (`SqliteSchedulerStore`) over
the [Durable SQLite provider](workers-durable-sqlite.md). Connects
[schedule definitions](scheduler.md), [queue rows](workers-durable-queues.md),
[platform scheduled events](workers-scheduled.md) and Object lifetime.

```ts
const scheduler = new Scheduler({ store: new SqliteSchedulerStore(database) })
await scheduler.at(queue, { numbers: [1, 3, 5] }, { id: 'daily-report', at: dueTime })
await scheduler.tick({ limit: 10 })
```

`queue` must use the same Object database. Include both queueMigrations and
schedulerMigrations in its [complete schema history](durable-sqlite-migrations.md).
Definitions, immutable IDs, next-occurrence cursors, cancellation and dispatch
counts persist in SQL. Existing one-time/interval/UTC-cron semantics and missed-run
policies remain in the portable Scheduler coordinator.

A tick transaction selects due state, inserts the stable occurrence job and
advances the cursor before committing. Competing clients serialize through the
same Object/provider ownership boundary. A SQL failure or Object interruption
before commit leaves both the occurrence and cursor unchanged. Cancellation waits
for the database operation ahead of it, retains committed jobs, and prevents future
dispatch. It does not cancel an already-owned queue attempt.

## Trigger boundary

Persistent schedule state does not wake an Object by itself. The
[report example](workers-durable-example.md) wires an outer Worker scheduled event
to its named Object via an awaited stub Fetch. The Object performs one tick of at
most ten occurrences and at most ten queue attempts, then returns a response.
The Worker awaits the response/body and reports failure if it is unsuccessful.

The private `/_tick` route exists only inside the Object; the outer HTTP app does
not proxy it. It is not a public admin endpoint. This example owns one named report
Object; it adds no cross-shard discovery/fanout. Recurring definitions in multiple
Objects need an explicit wakeup/routing strategy. The separate
[Object alarm timing host](workers-sqlite-alarms.md) now projects due state and
queue retry/lease deadlines atomically; [queue-batch events](workers-queue-events.md)
consume the platform broker through a different protocol.

Platform cron delivery and LongHorn's SQL schedule are distinct: the first wakes
the coordinator, the second determines due occurrences. Replayed triggers find
already-advanced cursors and do not insert an extra occurrence. Queue attempts and
external effects retain their at-least-once semantics. Cancellation/abort of the
outer Worker cannot undo already-admitted Object work or committed SQL. After a
cooperative budget expires, the Worker still awaits the actual stub response.

[Native proofs](workers-durable-testing.md) force failure and actual state.abort
between occurrence insertion/cursor update, then verify rollback on the next
Object instance. They also test concurrent dispatchers, cancellation, SQL restart
and the example's real workerd scheduled-event path.
