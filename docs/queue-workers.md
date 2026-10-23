# Queue workers

Owner: `@longhorn/queue` (`QueueWorker`). Connects to [queue coordination](queues.md),
[lifecycle](lifecycle.md), [logging](logging.md), and [the report example](jobs-example.md).

```ts
const worker = new QueueWorker(queue, handler, {
  concurrency: 2,
  pollIntervalMs: 250,
  onError: (error) => logger.error('Queue operation failed', {
    operation: error instanceof QueueStoreError ? error.operation : 'worker',
  }),
})
worker.start()
// Outside any handler, during host cleanup:
await worker.close()
await queue.close()
await database.close()
```

Construction does not start polling. `start` is single-use; starting after close
throws too. Concurrency defaults to 1 and is bounded from 1–64. Each loop awaits
one complete runOnce, so active handlers never exceed that bound per worker.
Multiple worker instances/processes can consume the same durable queue through
the provider's atomic claims. There is no global concurrency cap across processes.

Due work is claimed immediately after the previous attempt settles. Empty polls
and operational failures wait `pollIntervalMs` (default 250, positive integer).
After 32 non-idle attempts a loop yields to timers/I/O even with an immediately
resolving memory provider. Handler failures use the queue's durable retry schedule.
There is no dedicated sleep timer per delayed job.

`onError` receives operational exceptions. Log safe metadata deliberately;
provider causes may contain implementation details. A throwing observer cannot
kill polling: its first error is retained and surfaced by close after all loops
drain. `snapshot()` returns state (`idle/running/closing/closed`), active runOnce
calls (including claims), and the operational error count. Job failures are stored
in job status rather than counted as provider failures.

`close` is idempotent, wakes idle polls and stops future claims. Already admitted
claims may still acquire/finish one job per loop. Active handlers keep heartbeat
renewal and acknowledgement until settled. Closing does not abort graceful work,
close the queue, or close storage. Acquire database -> queue -> worker in separate
startup hooks, so reverse cleanup is HTTP -> worker -> queue -> database. Startup
rollback uses that same order. Do not close an owned resource from its handler.
When using [schedules](scheduler.md), acquire the coordinator before the worker
and its [timing runner](scheduler-runner.md) after the worker. The report app's full
cleanup is HTTP -> runner -> worker -> scheduler -> queue -> database.

Use polling on a host with an explicit lifetime, such as Node/Bun/Deno. In a Fetch
platform, schedule bounded runOnce calls through the platform's supported lifetime
mechanism and a suitable shared provider. A perpetual isolate polling loop is not
a durable Workers integration. [Durable scheduling](scheduler.md) is implemented;
the [platform queue adapter](workers-queue-events.md) handles broker triggers.
[PostgreSQL workers](queue-postgres.md)
use the same host API. Worker concurrency/drain/error tests are in `packages/queue/src/queue.test.ts`.

[Outgoing dispatchers](outbox-dispatcher.md) reuse this worker for native polling;
their handler publishes a stable-ID envelope and awaits remote acceptance. Fetch
hosts use bounded Outbox.dispatchOnce calls, as in the [alarm pipeline](outbox-worker-example.md).
