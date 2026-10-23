# SQLite schedule dispatch

Owner: `@longhorn/scheduler/sqlite`. Connects [schedules](scheduler.md),
[queue SQLite storage](queue-sqlite.md), [transactions](database.md) and [migrations](migrations.md).
It imports portable SQL contracts and the queue insertion primitive, not a Node driver.

```ts
await migrate(database, [
  ...existingApplicationMigrations,
  ...queueMigrations,      // only if not already in the deployed prefix
  ...schedulerMigrations,
])
const schedules = new SqliteSchedulerStore(database)
```

Use one complete ordered migration list and append to deployed history. Never
duplicate/reorder already applied queue entries. The report example's deployed
prefix remains queue -> report table; its new scheduler migration is appended last.
Both longhorn_schedules and longhorn_queue_jobs must live in the **same database**.
Workers must consume that same database and compatible destination queue/schema.

The STRICT schedule table stores immutable destination/payload/timing/missed policy,
attempt budget, state, first/next timestamps, dispatch count and last occurrence/job
metadata. Checks enforce states and next-cursor nullability. A partial active index
supports due cursor ordering. Definitions remain after cancellation/completion;
there is no automatic purge or editing/revival API.

Registration uses a write transaction to insert-or-return an existing ID without
resetting its cursor. The coordinator compares immutable fields and rejects
conflicts. Cancellation uses a conditional active-state update. A dispatch write
transaction selects due schedules, calculates occurrences, inserts each queue job
through insertSqliteJob(tx, ...), and advances cursors. The entire bounded tick
commits or rolls back. No nested connection transaction is opened by insertion.

SQLite writer serialization coordinates separate processes without a timer leader
or dispatcher lease. A process killed after an insertion but before cursor update
leaves both writes uncommitted; reopening recovers the previous cursor and no orphan
job. Once committed, that occurrence and cursor are visible together. Another host
sees the advanced cursor and inserts only later nominal timestamps.

Reserved deterministic IDs prevent accidental repeated occurrence insertion from
being silently accepted. A manually inserted colliding ID causes the tick to fail
and roll back. Fix the conflicting data/configuration before retrying. Do not purge
active definitions/cursors or manually rewind them to replay work.

The store borrows Database. [Node local SQLite](sqlite.md) supplies write transactions,
WAL, FULL synchronous mode and a busy timeout. Timers and
coordinators need synchronized clocks. This is same-file/local-filesystem multi-process
coordination; cross-machine shared-filesystem locking and other SQL providers are
outside the verified boundary. Queue effects remain at-least-once.

Storage tests cover migration replay, concurrent callers, cancellation and injected
rollback. `pnpm test:scheduler` starts two independent dispatcher processes, proves
unique queued occurrences, preserves cursors after restart, and kills a third process
inside its actual write transaction before verifying recovery and SQLite integrity.

The same store is also verified over [Durable Object SQLite](workers-durable-sqlite.md).
That provider uses a private Object SQL database and input/native transaction gates,
with its own numeric/lifetime boundary. `pnpm test:worker-storage` proves concurrent
dispatch/cancel, rollback and actual Object interruption between occurrence and
cursor writes, plus full-host restart. See [Worker schedule storage](workers-durable-scheduler.md)
and [native proofs](workers-durable-testing.md); Node filesystem guarantees above
do not apply to that binding.
