# Durable schedules

Owner: `@longhornjs/scheduler`. Connects [queue preparation](queues.md),
[UTC cron](cron.md), [timing hosts](scheduler-runner.md), [SQLite storage](scheduler-sqlite.md),
[memory storage](memory-scheduler.md), and [scheduled reports](scheduled-reports.md).
The [PostgreSQL provider](scheduler-postgres.md) connects the same timing/coordinator contracts.
The root module imports no Node, HTTP or database implementation.

```ts
const scheduler = new Scheduler({ store: new SqliteSchedulerStore(database) })
await scheduler.at(reports, { numbers: [2, 4] }, {
  id: 'one-report', at: Date.now() + 60_000,
})
await scheduler.every(reports, { numbers: [2, 4] }, {
  id: 'hourly-report', intervalMs: 3_600_000, missed: 'latest',
})
await scheduler.cron(reports, { numbers: [2, 4] }, {
  id: 'weekday-report', expression: '0 9 * * 1-5', missed: 'catch-up',
})
const batch = await scheduler.tick({ limit: 100 })
const status = await scheduler.get('hourly-report')
await scheduler.cancel('hourly-report')
await scheduler.close()
```

Use the same backing queue database/provider as the schedule store. The Queue
argument supplies the destination name and schema; it does not redirect the
schedule store to that Queue's connection. SQLite requires the same file containing
both sets of tables. A memory Queue must use its MemorySchedulerStore.queueStore.
Scheduling on a separate unconnected backend will not feed that Queue's workers.

## Definitions and registration

`at`, `every`, and `cron` accept the destination Queue's payload type and call
Queue.prepare. This performs Standard Schema validation and bounded JSON snapshotting
without enqueueing. The payload, queue name and attempt budget are persisted with
the schedule. Schema evolution follows the destination's versioned queue-name
contract. Payloads are fixed at registration, rather than regenerated on each tick.

IDs default to a UUID; explicit IDs match `[a-zA-Z0-9._-]{1,100}`. Re-registering
the same explicit ID and identical definition returns the existing state/cursor.
It neither resets progress nor revives cancelled/completed schedules. A different
queue, JSON payload string, timing, missed policy or maxAttempts throws
ScheduleConflictError. Definitions are immutable; use a new ID to change them.
Serialization order is part of payload equality. There is no semantic JSON comparison.

An omitted startAt is persisted as an implicit-start definition. The first successful
registration anchors the initial occurrence; other hosts can ensure that same ID
without changing its anchor. An explicit startAt is part of the immutable definition.
Concurrent SQLite registration atomically creates one definition, then all callers
compare against the winning row. One conflicting caller can succeed and the other
reject; the existing definition is never overwritten.

One-time timestamps are epoch milliseconds. Fixed intervals are positive safe
integer milliseconds: default first occurrence is now + intervalMs; an explicit
startAt is the inclusive first occurrence. Intervals remain anchored to that
nominal timeline instead of completion time. Cron uses [five-field UTC rules](cron.md):
the default is strictly after current time, or at/after explicit startAt. Timestamps
range from epoch zero through JavaScript's maximum Date (8640000000000000).
When no later occurrence is representable, a dispatched schedule completes.

## Missed runs and dispatch

One-time work is enqueued once even when overdue. Recurring definitions choose:

| Policy | Delayed poll / restart behavior |
| --- | --- |
| `latest` (default) | Enqueue the most recent nominal occurrence at/before now, discard older missed occurrences, advance to the next one |
| `catch-up` | Enqueue every due nominal occurrence in order over bounded batches, preserving the remaining cursor |

`tick` dispatches at most limit occurrences (default 100; 1–1000) and returns
`{ dispatched: [{ scheduleId, scheduledAt, jobId }], more }`. Due schedules order
by current nextAt, creation time, then ID; the cursor is re-selected after each
occurrence. A latest policy may emit a newer nominal timestamp before an older
one on another schedule because selection uses the persisted due cursor.
Large catch-up backlogs can delay newer work; the runner yields between batches.

Providers must atomically pair each queue insertion with the corresponding cursor
advance. SQLite does this in one write transaction for the whole tick. Dispatch
uses job ID `scheduled:<scheduleID>:<nominalTimestamp>` and makes it immediately
available at the tick's now. The scheduled timestamp is in tick/status metadata;
the fixed job payload is unchanged. This ID namespace is reserved for the scheduler.
Normal Queue.enqueue creates UUIDs. Do not manually insert colliding scheduled IDs.

Multiple SQLite hosts may tick the same file. Write serialization plus cursor
advancement produces one inserted job per schedule/nominal timestamp, including
after crash recovery. Queue workers still provide at-least-once execution, so
effects remain idempotent by job ID. Scheduling does not wait for prior occurrences
to finish, impose global execution limits, or guarantee exact wall-clock starts.

Cancellation is serialized against dispatch. If cancellation commits first, that
schedule has no later insertions. If dispatch commits first, its queued occurrences
remain available. `cancel` returns true only for active -> cancelled, false for an
unknown/inactive ID. It does not cancel queued/running jobs. Status reads expose
state, timing, first/next times, dispatch count, last nominal timestamp/job ID, and
creation/update times; they omit payload and the stored retry budget. Reads do not tick.

## Ownership and errors

Scheduler owns admission and accepted registrations/ticks/reads/cancellations.
Close rejects new work with SchedulerClosedError and drains accepted operations,
including async queue validation and the final store commit. It borrows queues and
storage and closes neither. Timing/ID/policy errors are ScheduleInputError; payload/attempt errors
retain their queue/validation types. Only adapter failures become SchedulerStoreError
with operation/cause. Callers retain their business errors; cleanup does not consume them.

The coordinator uses wall-clock now (injectable for tests). Hosts need synchronized
clocks. Backward movement defers work until its cursor becomes due again; forward
movement follows the selected missed policy. Poll delays, restarts and I/O affect
actual insertion time. There is no distributed timer leader: atomic storage owns
dispatch coordination. A Fetch host may invoke bounded ticks using its platform
lifetime and a shared provider. No durable Cloudflare scheduler provider is shipped.

Close timing hosts before workers, then Scheduler, Queue and database. Never await
close from work that close itself is draining. Definition listing/editing, retention,
pause/resume, timezone/DST rules, dynamic payloads, job cancellation and administrative
replay remain later features. See the [feature index](features.md) for connections.

## Verification

Unit/type suites cover typed registration, defaults/ID conflicts, missed policies,
cron, cancellation, shared ticks, errors and admission/drain. Storage tests run
against memory and SQLite and inject a cursor-write failure after queue insertion.
`pnpm test:scheduler` runs built contracts across Node/Bun/Deno/workerd, then real
SQLite dispatcher processes, a SIGKILL inside a transaction, and report HTTP/restarts.
`pnpm test:postgres` separately verifies native PostgreSQL dispatch/cancellation,
competing processes, crash rollback and report HTTP restart; see [its proofs](postgres-background-testing.md).
