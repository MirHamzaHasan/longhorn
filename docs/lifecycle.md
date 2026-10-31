# Application lifecycle

Owner: `@longhornjs/core`. Connects to [runtime listeners](runtimes.md),
[DI services](dependency-injection.md), [configuration](configuration.md), and
[logging](logging.md).

## API

```ts
const app = new Longhorn()

app.onStart(async () => {
  const connection = await openConnection()
  app.container.register(provide(Connection, { factory: () => connection }))
  return async () => { await connection.close() }
})
app.onStop(() => { app.logger.info('Resources released') })

await app.listen(nodeRuntime, { port: 3000 })
// Later, from the host's signal handler:
await app.close()
```

The connection and token above are application-owned examples. Startup hooks may
return a cleanup callback. Callbacks can be synchronous or async. Register hooks
before startup; `onStart` and `onStop` return the app for chaining.

`start()` runs startup hooks sequentially in registration order. Concurrent callers
share one startup promise. `listen()` starts the app before invoking the runtime
adapter. `fetch()` lazily starts the app before dispatching a Web Standard request.
`run(callback)` starts the same lifecycle for managed non-HTTP work; see
[application work](application-work.md) for callback values, errors and ownership.
For explicit startup in a Fetch host, use `await app.start()`.

`app.http.request()` and `app.http.fetch()` are raw Hono APIs and bypass lifecycle
startup. Tests or hosts using those APIs with acquired resources must start the app
explicitly. Prefer `app.fetch()` for portable application dispatch.

## Shutdown order

`app.close()` is idempotent and concurrent callers share the same promise:

1. Wait for pending listener startup attempts.
2. Close all owned listeners in reverse acquisition order. Node closes the server
   and waits for active HTTP connections before its close promise resolves.
3. Wait for handlers dispatched through `app.fetch()` and callbacks accepted by
   `app.run()`, including Fetch-only and non-HTTP hosts.
4. Release resources returned by successful startup hooks, in reverse order.
5. Run `onStop` hooks in reverse registration order.

All cleanup callbacks are attempted even if one fails. Shutdown errors are collected
in `AggregateError`; nested aggregates retain errors from individual cleanup phases.
Stop hooks also run when closing an app that never started. Runtime listener handles
must implement idempotent `close()`; closing a handle separately closes only that
listener, while `app.close()` also releases application resources.

## Failure behavior

A failed startup hook prevents later hooks and listener startup. Previously acquired
resources are released and stop hooks run. If rollback also fails, the original
startup error and cleanup errors are retained together. A hook that throws before
returning its cleanup must handle its own partially acquired resource.

A failed bind releases application resources if no other listeners are active or
starting. Failing to add another listener leaves existing listeners running.
Shutdown racing with startup waits for acquired resources and pending listeners,
closes any listener that finished opening, and prevents it from being returned as
an active server.

`app.state` is `idle`, `starting`, `running`, `stopping`, `stopped`, or `failed`.
An application has one lifecycle: create a new instance to restart after shutdown
or startup failure. Requests through `app.fetch()` reject after closing begins.
Hooks must not await `app.start()` or `app.close()` from inside themselves; those
operations wait for the hooks to finish. Trigger shutdown from host code outside an
active request handler or managed callback, since shutdown waits for them to return.

Host signals, shutdown deadlines, and forceful connection termination remain host
policy. Direct Fetch draining covers handler completion; the host owns streaming
body transmission after a Response is returned. Raw Hono dispatch bypasses tracking.
Shared core imports no process or network APIs.

## Verification

[Core lifecycle tests](../packages/core/src/lifecycle.test.ts) cover hook order,
startup sharing, rollback, aggregated failures, failed binds, and startup/shutdown
races. [The Node drain test](../examples/basic/src/lifecycle.test.ts) holds an HTTP
request open and verifies its resource remains available until the listener drains.
The [example entrypoint](../examples/basic/src/index.ts) connects Node signals to
`app.close()` and logs startup/shutdown.

Native Bun/Deno draining and cleanup are also verified by `pnpm test:runtimes`.
See [Workers](workers.md) for the platform-owned isolate/background lifetime boundary.
The [scheduled adapter](workers-scheduled.md) owns bounded scheduled admission and
registers managed completion with platform waitUntil. Its close drains scheduled
work without closing Fetch or the shared app. [Native proofs](workers-scheduled-testing.md)
hold ignored-abort work open while adapter and core close concurrently.

## Event ownership

Application events are opt-in resources. Register their startup/cleanup after the
resources subscribers use, so reverse cleanup drains events before closing those
resources. The tasks app acquires SQLite first and closes its event bus before the
database. Accepted external emissions and context-owned follow-ups are drained too.
See [events](events.md), [subscriptions](event-subscriptions.md), and
[task activity](task-events.md) for the concrete wiring and failure policy.

## Cache ownership

The task summary cache is acquired after SQLite and before event subscribers.
Shutdown drains HTTP, then event callbacks/follow-ups, then cache loaders, then
closes SQLite. Cache close rejects new work but lets accepted source reads finish;
it skips their no-longer-useful implicit cache writes before closing the store.
See [cache](cache.md), [memory storage](memory-cache.md), and
[task summary integration](task-cache.md). Source errors remain with their caller;
cleanup does not silently turn a failed read into a successful one.

## Queue ownership

The separate report app acquires database -> queue -> scheduler -> worker -> timing
runner, then readiness checks. Shutdown drains HTTP and underlying readiness operations,
stops the runner, then stops worker claims/wakes idle polls and awaits active attempts with heartbeat
renewal. Queue close then stops all remaining admission and drains accepted calls;
the scheduler closes before the queue and SQLite closes last. Startup rollback releases those same resources in reverse order.
The queue/store borrow the connection. Calling close from an owned handler would
wait for itself; initiate cleanup from the host. See [queues](queues.md),
[workers](queue-workers.md), [SQLite queue storage](queue-sqlite.md), and
[the report app](jobs-example.md) for retry/crash/duplicate-effect boundaries.

## Schedule ownership

The Scheduler coordinator owns accepted registration/get/cancel/tick operations;
its store borrows the queue database. SchedulerRunner separately owns the host timer
and serial tick loop. Stop the runner before workers so it commits no later work
during worker cleanup; a tick already accepted at close is allowed to finish.
Next drain queue handlers, close Scheduler and Queue, then close SQLite. Scheduling
cancellation is a persisted operation distinct from host shutdown: closing a host
leaves active definitions available to another process/restart. See [schedules](scheduler.md),
[timing hosts](scheduler-runner.md), [SQLite dispatch](scheduler-sqlite.md), and
[scheduled reports](scheduled-reports.md) for the wiring and atomic commit boundary.

## Observability ownership

The report app starts readiness after its dependencies and closes it before those
dependencies. A timed-out response does not abandon the underlying check; close
waits for that work, and cooperative checks honor their AbortSignal. The host marks
readiness draining before app.close, optionally keeping a short probe window via
SHUTDOWN_GRACE_MS. Native listener/Fetch draining still belongs to core.

Tracing/export and metrics close in final onStop after background attempts and SQL
finish. Tracer drains accepted recording spans and serial exports before exporter
close; metric snapshots stay readable after updates stop. Failed export does not
fail business work; exporter close failure participates in core cleanup aggregation.
Portable/generated apps follow the same ownership without database/background
checks. Workers owns isolate termination, so no final flush is promised there.
See [health](health-checks.md), [tracing](tracing.md), [HTTP telemetry](http-telemetry.md),
and [report diagnostics](jobs-observability.md) for tests and limits.

## Durable Object resources

An Object can own its own Longhorn app and DI graph. The
[durable report example](workers-durable-example.md) acquires a borrowed Object SQL
handle, applies the complete schema history, then acquires queue and scheduler
coordination. Request drain precedes reverse scheduler/queue/database cleanup.
Provider close drains accepted callbacks and synchronizes writes without deleting
platform storage. Do not await it from the callback it must drain.

Object eviction/reset is platform-owned and does not guarantee general app cleanup.
Fresh instances reconstruct their app and recheck persisted migrations; SQL rows
carry the state across those instances. See [transaction ownership](durable-sqlite-transactions.md)
and [native interruption/restart proofs](workers-durable-testing.md).

## Platform queue batches

The [queue-event adapter](workers-queue-events.md) owns each batch through app.run,
including all started message callbacks and awaited afterBatch telemetry. Its
close stops queue admission and drains accepted batches; it leaves Fetch/app open.
Budgets are cooperative and never free resources while an ignored-abort callback
is still using them. Core close waits for managed completion before resource cleanup.
Explicit ack/retry decisions can already have reached the platform before a later
message/hook fails; shutdown is not an effect/ack transaction. See
[batch ownership](queue-batch-lifecycle.md), [consumer telemetry](queue-consumer-telemetry.md)
and [native close proof](workers-queue-testing.md).

## Object alarms

The [alarm report host](alarm-report-example.md) acquires database -> clock ->
queue -> scheduler. Its native alarm method returns clock.alarm, which owns work
through app.run. Shutdown drains requests/managed callbacks, then closes scheduler,
queue, clock and database; shared tracing closes last. Clock close waits for entered
work/reconciliation, including recovery writes after ignored cancellation. It avoids
waiting on an invocation still awaiting the same startup during rollback.

Clock close preserves wakeups for durable remaining work and is not cancellation
or an eviction callback. The platform can reconstruct the Object without final app
cleanup. See [host ownership](workers-sqlite-alarms.md), [recovery](alarm-recovery.md)
and [native resource proof](workers-alarm-testing.md).

## Transaction publishers

The [typed transaction helper](transaction-publishing.md) registers preparation/
insertion with both Queue admission and the database's managed transaction scope.
Queue close drains that work; the database still owns the enclosing commit or
rollback. Built-in providers wait for accepted publishers even if a callback
returns early, and prevent new writes through an expired public executor.
Business failure stops later participant writes and joins actual work before
rollback. Core HTTP/app.run draining should surround the whole transaction, so
resource cleanup starts after its final outcome. See [executor ownership](transaction-executors.md)
and [native async/close proof](transaction-publishing-testing.md).

[Idempotency](idempotency.md) borrows a store/database and opens no timers or
connections itself. Keep the complete run operation inside HTTP/app.run ownership,
including input hashing before transaction admission, so closing resources cannot
race the start of a database operation. Explicit bounded pruning needs the same
host ownership; no automatic cleanup scheduler is installed.

[Outbox dispatchers](outbox-dispatcher.md) reuse QueueWorker ownership. Close the
dispatcher before Outbox/database release; Outbox close also joins admitted prune
operations. Broker acceptance must remain awaited even when cancellation cannot
stop the underlying send. Object alarms own bounded dispatch without a perpetual
isolate polling loop; platform eviction is still distinct from application close.

The optional [inspection/retry capability](outbox-inspection.md) uses the same
maintenance admission/drain as pruning. Close waits for accepted metadata reads and
conditional transitions. Database/clock/publisher lifetime remains host-owned;
authorization does not replace full HTTP/app.run ownership of an operator action.

[Audited retry/history/retention](outbox-audit.md) also join that maintenance drain.
The audited native callback owns both transition and append before commit/alarm
projection. Resource cleanup must wait for that final outcome; there is no detached
audit writer to continue after database release.

## Owned native computation

The jobs app's [async computation factory](report-computer-resources.md) acquires
after database startup and before queue/worker/readiness startup. The optional
[Node process resource](managed-node-process.md) joins actual direct-child exit;
its [Rust wrapper](owned-native-reports.md) drains client calls before stopping
that process. Reverse cleanup therefore preserves compute and SQL ownership while
reports settle. The [persistent host](native-jobs-host.md) installs early parent
signals to abort startup acquisition, handles bind rollback and reports unexpected
child failure during shutdown. Core does not gain process or parent-signal APIs.
