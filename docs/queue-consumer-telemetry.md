# Queue consumer telemetry and completion

Owner: application handler/afterBatch and `@longhorn/observability`. Connects
[explicit tracing](tracing.md), [batch lifetime](queue-batch-lifecycle.md),
[message decisions](queue-message-decisions.md), DI and exporter ownership.

```ts
const worker = createQueueWorker(app, {
  handle: (invocation) => tracer.trace('queue.process', () => process(invocation), {
    kind: 'consumer', attributes: { 'messaging.operation': 'process' },
  }),
  afterBatch: async () => { await tracer.flush() },
})
```

`tracer` and `process` are application-owned services; process returns a decision.
The [receipt example](queue-worker-example.md) resolves tracing from app DI and uses
a bounded MemorySpanExporter. Queue events have no HTTP trace header context.
Use explicit contexts when the application's payload contract deliberately carries
one. No raw body, message ID, business key or queue name becomes a label automatically.

afterBatch runs once after the entered processing pool settles, including partial
failure and cooperative abort, and receives the original invocation plus a summary.
It is skipped when admission, registration or startup prevents processing entry.
An awaited flush stays inside app.run, the queue slot and platform completion. Its
duration counts toward the cooperative event budget. Ignored cancellation does
not release those lifetimes while export is still active.

## Failure and acknowledgement boundary

The hook runs after successful message decisions have already invoked native ack/
retry. A rejected hook adds its original error to the batch failure; it cannot
revoke those decisions. Tracer's ordinary export failure policy remains bounded
and best effort: export diagnostics can change without failing business work.
A custom rejecting hook still follows adapter rejection policy. Awaited flush
does not promise durable remote retention. [OTLP delivery](otlp-delivery.md) has
its own admission/deadline/acknowledgement contract when explicitly selected.

Keep module-scoped tracing open across events. Flush per batch; close it only when
its owning application ends. Workers termination does not supply a guaranteed
final application flush. Return/await every descendant that needs these resources;
a detached context.waitUntil promise is separately platform-owned.

The [native fixture](../scripts/fixtures/worker-queues.mjs) holds an actual span
export request behind an owned HTTP gateway. The event stays active until that
request completes. [Native tests](workers-queue-testing.md) also inspect consumer
span names/privacy, ignored-abort resource drain and the compiled example's exports.
