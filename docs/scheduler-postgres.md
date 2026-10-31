# PostgreSQL schedule dispatch

Owner: `@longhornjs/scheduler/postgres`. Connects [Scheduler](scheduler.md), [UTC cron](cron.md),
[timing hosts](scheduler-runner.md), [PostgreSQL queues](queue-postgres.md), and
[task reports](postgres-reports.md). No Node APIs or timer are imported by the store.

```ts
import { postgresQueueMigrations } from '@longhornjs/queue/postgres'
import { PostgresSchedulerStore, postgresSchedulerMigrations } from '@longhornjs/scheduler/postgres'

await migratePostgres(owner, [
  ...existingMigrations, ...postgresQueueMigrations, ...postgresSchedulerMigrations,
], { schema: 'app_history' })
const scheduler = new Scheduler({ store: new PostgresSchedulerStore(runtimeDatabase) })
await scheduler.every(queue, data, { id: 'daily-summary', intervalMs: 86_400_000 })
await scheduler.tick({ limit: 100 })
```

Use one complete history and append migrations after its deployed prefix. The fixed
longhorn_scheduler.schedules table and longhorn_queue.jobs must be in the same database.
A queue on another database/name/schema will not consume these occurrences. The store
borrows its Database; the application owns migrations and shutdown.
Schedule IDs share the fixed table's database-wide namespace; prefix them for
independent applications. Queue names likewise identify shared handler contracts.

Definitions are immutable through Scheduler. INSERT ON CONFLICT DO NOTHING followed
by a separate READ COMMITTED SELECT observes the concurrent winner without updating
its cursor/state. Scheduler compares the stored queue/payload/timing/policy/attempts
and rejects a changed definition with ScheduleConflictError. Re-registering a completed
or cancelled schedule never revives it. Timing/payload stay text to preserve exact
serialized definition order; persisted millisecond/count values use constrained bigint.

Dispatch locks the oldest available due cursor with FOR UPDATE SKIP LOCKED, computes
the occurrence using the shared once/interval/cron implementation, inserts its queue
job, and advances its cursor in one transaction. Stable IDs use
scheduled:&lt;schedule ID&gt;:&lt;scheduled millisecond&gt;. Any insert/cursor failure rolls back
the entire tick batch. The job ID primary key also rejects accidental collisions.
Do not pre-enqueue a manual job using a schedule's reserved ID.

Each tick dispatches at most limit (Scheduler range 1–1000). Parallel dispatchers
skip locked cursors and can return no work while another tick owns a due schedule.
more reports further currently lockable work in that transaction; it is a polling
hint, not a complete count. SchedulerRunner polls again after normal idle delay;
there is no leader, LISTEN subscription or per-schedule timer. Due order prioritizes
old cursors. Large catch-up backlogs can delay later schedules and create many jobs
across successive bounded ticks; default latest coalesces missed recurring work.

Cancellation locks/updates an active cursor. If dispatch already owns it, cancellation
waits, then preserves committed occurrences and prevents future dispatch after its
successful return. If cancellation wins first, dispatch skips the cancelled cursor.
Already queued/running jobs remain. Effects still follow queue at-least-once delivery;
atomic occurrence creation does not make handlers execute exactly once.

Runtime needs schema USAGE and schedules SELECT/INSERT/UPDATE, plus queue privileges.
Clocks are supplied by Scheduler and must agree across hosts. Retention, schedule
editing, timezones/DST, fairness controls and platform triggers remain separate work.
[Native verification](postgres-background-testing.md) exercises real locks and process crashes.
