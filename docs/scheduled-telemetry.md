# Scheduled-event telemetry ownership

Owner: application handler plus `@longhorn/observability`. Connects [explicit tracing](tracing.md),
[exporters](memory-traces.md), [scheduled events](workers-scheduled.md), and
[managed work](application-work.md).

Scheduled events have no HTTP trace headers or Hono request context. Start an
explicit consumer span with a fixed name, then await export inside the invocation:

```ts
handle: async (invocation) => {
  try {
    await tracer.trace('scheduled.audit', () => audit(invocation), {
      kind: 'consumer', attributes: { 'trigger.kind': 'cron' },
    })
  } finally {
    await tracer.flush()
  }
}
```

`tracer` and `audit` above are application-owned services. The
[audit example](workers-scheduled-example.md) resolves its tracer through DI and
keeps raw cron, event IDs, bindings and credentials out of attributes. The
generated Workers starter uses `worker.scheduled` and exposes isolate-local
observations at `/scheduled`.

## Completion and failure policy

Awaited flush stays inside `app.run`, the scheduled slot and the platform
completion Promise. Its duration counts toward the cooperative budget. The
adapter does not add telemetry implicitly or promise final export on isolate
termination. Detached `context.waitUntil(tracer.flush())` is platform-owned and
does not extend core's managed callback drain.

Tracer retains its documented bounded queue, serial export and best-effort export
failure policy: ordinary export failure increments diagnostics without replacing
the business result. A custom callback/flush that rejects follows ordinary
scheduled rejection policy. Awaiting flush is not an acknowledgement that a remote
system durably stored data. [OTLP delivery](otlp-delivery.md) adds its own transport
admission, acknowledgement, retry and deadline rules when explicitly selected.

Keep a module-scoped tracer open between events; `flush` does not close it. Do not
close a shared app/tracer per event. An invocation-owned tracer can instead be
closed in the invocation's `finally`, as the native test fixture does. Host-owned
application shutdown closes shared tracing after managed work drains. Workers
provides no guaranteed general-purpose eviction cleanup callback.

## Verification

[Adapter unit tests](../runtimes/workers/src/scheduled.test.ts) hold awaited final
work open and verify slot ownership. The [native fixture](../scripts/fixtures/worker-scheduled.mjs)
holds a real export request behind a controlled gateway. Workerd cannot complete
the event until that export is released. The [native gate](workers-scheduled-testing.md)
also checks fixed consumer span names and absence of raw cron/job IDs; project
verification checks the freshly generated Worker's consumer span.
