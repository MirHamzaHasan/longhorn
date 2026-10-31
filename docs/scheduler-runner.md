# Scheduler timing host

Owner: `@longhornjs/scheduler` (`SchedulerRunner`). Connects [schedules](scheduler.md)
to [application lifecycle](lifecycle.md), [logging](logging.md) and [queue workers](queue-workers.md).

```ts
const runner = new SchedulerRunner(scheduler, {
  pollIntervalMs: 250, batchSize: 100,
  onError: (error) => logger.error('Schedule tick failed', {
    operation: error instanceof SchedulerStoreError ? error.operation : 'runner',
  }),
})
runner.start()
await runner.close()
```

Construction creates no timers. start is single-use and begins an immediate tick.
One loop awaits a bounded tick; it never overlaps its own store calls. If more due
work remains it yields through a zero-delay host timer before the next batch.
Otherwise it waits pollIntervalMs (default 250). Batch size defaults to 100 and
ranges from 1–1000. Poll interval is a positive integer bounded by timer capacity.
Actual execution time depends on host scheduling/I/O, not just that interval.

Operational errors are reported and retried after the poll interval. A throwing
onError cannot stop dispatch: the first observer error is retained and surfaced
by close after drain. snapshot returns state (idle/running/closing/closed), whether
a tick is active, error count, and the number of dispatched occurrences observed
by this runner. These are process-local diagnostics, not durable delivery totals.

close is idempotent, wakes idle timers, prevents later ticks, and waits for an
already admitted tick to commit or fail. It does not cancel schedules, delete
queue jobs, close Scheduler, or close storage. Another process may continue ticking.
Acquire resources so reverse cleanup stops the timing host before queue workers,
then closes Scheduler, Queue and database. Existing HTTP requests drain first.
The report app follows this order, including rollback.

Use this runner on a host with an owned lifetime such as Node/Bun/Deno. Fetch
platforms should invoke bounded scheduler.tick through a supported platform trigger
and suitable shared provider. A perpetual isolate timer is not a durable platform
integration. The [Workers scheduled adapter](workers-scheduled.md) now supplies
that bounded trigger lifetime. Its [audit example](workers-scheduled-example.md)
uses invocation-local memory state and KV effects; it does not supply durable
shared schedule/queue storage. Unit tests exercise active-tick drain, idle wakeup,
observer failures and single-use lifecycle; native HTTP checks execute the runner.

For SQLite-backed Objects, the [alarm timing host](workers-sqlite-alarms.md) now
replaces a perpetual poller with atomic persisted wakeups. It follows schedules,
pending jobs and running lease deadlines in the same storage transaction as writes.
See [planning](alarm-wakeup-planning.md), [recovery](alarm-recovery.md) and
[automatic reports](alarm-report-example.md); the Node/Bun/Deno runner above keeps
its existing host-owned timer/lifecycle behavior.
