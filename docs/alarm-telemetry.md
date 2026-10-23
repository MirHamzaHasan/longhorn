# Alarm consumer telemetry ownership

Owner: application callback and `@longhorn/observability`. Connects
[alarm lifetime](workers-sqlite-alarms.md), [report DI](alarm-report-example.md),
[explicit tracing](tracing.md) and [recovery](alarm-recovery.md).

```ts
handle: async ({ signal, limit }) => {
  try {
    await tracer.trace('alarm.reports', () => runReports({ signal, limit }), {
      kind: 'consumer', attributes: { 'trigger.kind': 'alarm' },
    })
  } finally {
    await tracer.flush()
  }
}
```

The tracer/report service above belong to the application. The example resolves
the tracer from DI, uses a bounded MemorySpanExporter and exposes /alarm-traces.
It records no raw queue/schedule/job IDs, payloads or HTTP header context. Native
alarm retry metadata is an explicit input, not an implicit global trace parent.

Awaited flush remains inside the alarm's app.run callback and cooperative budget.
The platform receives the actual returned Promise; there is no invented HTTP
execution context. An ignored export cancellation retains the real resource user.
The clock performs final wakeup reconciliation after the callback/flush, and
persists its recovery floor if that owned work rejects.

Earlier queue/effect transactions have already committed. A later trace callback,
flush or final projection failure does not undo a report result or acknowledgement.
Tracer retains its ordinary best-effort export policy: an exporter failure normally
updates diagnostics without replacing a business outcome. A custom rejecting
callback follows native alarm failure/recovery policy. Awaited export does not
guarantee downstream durable storage; [OTLP delivery](otlp-delivery.md) has its own
transport contract when selected explicitly.

Keep a shared tracer open between alarms and close it after background/database
resource cleanup. Object reset/eviction does not promise a final application flush.
Return/await descendants that need these resources; detached work is not discovered
by the clock. [Native tests](workers-alarm-testing.md) inspect fixed consumer spans,
privacy and actual callback ownership; existing tracer/native collector suites
continue to own export failure, buffering and remote transport proof.
