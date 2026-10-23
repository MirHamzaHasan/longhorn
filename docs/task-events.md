# Task events and activity observations

Owner: `examples/basic/src/task-events.ts` and the task service. Connects existing
SQLite task writes to [typed events](events.md), DI, request IDs, structured logging,
and [subscription cleanup](event-subscriptions.md).

Run `pnpm dev`, mutate tasks through the existing API, then inspect:

```sh
curl http://127.0.0.1:3000/activity
```

Example result after a create:

```json
{
  "activity": {
    "created": 1,
    "updated": 0,
    "deleted": 0,
    "latest": {
      "eventId": "<event UUID>",
      "name": "task.created",
      "taskId": "1",
      "requestId": "<HTTP response X-Request-Id>"
    }
  }
}
```

The route is part of the existing public tasks example, not the private auth notes
API. Its counters are process-local observations and reset on restart. SQLite task
data remains durable. This is not a persistent audit log or a cross-process total.
Only counts and the latest event metadata are retained; titles are not retained in
activity state or written by the example's event logger.

## Producer and consumer connections

| Part | Owns | Connection |
| --- | --- | --- |
| `TaskCreated`/`TaskUpdated`/`TaskDeleted` | Typed definitions | Shared symbol identity between service and observers |
| `TaskEvents` | DI token for `EventBus` | One lazy singleton per application |
| `TaskActivity` | DI token for tracker | Bounded counts/latest metadata read by `/activity` |
| `TasksService` | Producer | Awaits successful store mutations, then awaits dispatch |
| Hono routes | Correlation | Pass the generated request ID to the service |
| `configureTaskEvents` | Subscriber ownership | Registers an observer scope in startup and returns bus cleanup |
| `configureSqliteStorage` | Resource ordering | Acquires/migrates DB, then cache, then event lifetime |

Create emits `task.created` with the committed task. Every successful update emits
`task.updated`, including an update setting the same completion value. A successful
delete emits `task.deleted` with the requested task ID. Missing tasks, validation
failures, and failed store writes emit nothing. Envelopes and the example's task
snapshots are immutable. Consumers receive the original task value by reference.

The observer updates counters and logs event name, event ID, task ID, and request
ID. Dispatch is awaited, so the next `/activity` request sees that successful
observation when the write response has returned. Independent writes may overlap;
`latest` means the last observed operation, not a global transaction sequence.

## Post-commit error policy

The task store resolves after its write has committed. A listener failure cannot
undo that write. The service therefore catches delivery failure, logs failure count
and correlation metadata, and retains the successful HTTP write result. It does
not serialize arbitrary thrown values, which may contain task payloads. Other
listeners are still attempted by the bus.

This choice prevents a failed observation from becoming a misleading failed write
that a client might retry and duplicate. It does not guarantee delivery: a process
can stop between commit and publish, and a failing observer is not retried. Critical
delivery would require an application transaction outbox and a durable queue, neither
of which is implied by this in-process bus.

## Lifecycle and verification

The executable registers SQLite startup, then cache startup, then event startup. Cleanup stops HTTP
and drains requests, closes/drains events and their scopes, then closes SQLite.
Explicit memory-store test applications register the same event lifetime without
native storage. Raw `app.http.request` bypasses core startup; use `app.fetch` or
`app.listen` when checking lifecycle-owned observers.

`examples/basic/src/events.test.ts` verifies TCP activity and correlation, no events
for unsuccessful writes, observer failure isolation without payload logging,
application isolation, startup rollback, and database availability during external
event draining. `pnpm test:events` additionally runs the compiled task host, checks
logs and repeated updates, restarts it, and proves that activity resets while saved
tasks remain. The [portable app](portable-example.md) and generated starters also
include an awaited echo event and a `/events` observation route.
