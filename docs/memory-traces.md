# Memory span exporter

Owner: `@longhorn/observability/memory` (`MemorySpanExporter`). Connects the
[Tracer exporter contract](tracing.md) to bounded local diagnostic snapshots.

```ts
const exporter = new MemorySpanExporter({ capacity: 128 })
const tracer = new Tracer({ exporter })
// After work finishes:
await tracer.flush()
const spans = exporter.snapshot()
```

Capacity defaults to 128 records (1–10000). When full, each incoming record replaces
the oldest and increments overwritten. Batch input and snapshot output are copied,
including contexts and scalar attribute maps. Mutating a returned record does not
change the buffer. stats exposes size/overwritten/closed. close is idempotent and
stops later export calls; snapshots remain readable for final diagnostics.

This provider retains no open connections and has no timers, disk persistence,
remote delivery or cross-isolate sharing. The Tracer owns its close ordering. Its
capacity is separate from Tracer active/queued/in-flight bounds. Keep custom span
attributes free of sensitive data; the exporter does not redact arbitrary fields.

The local /traces endpoint in jobs/portable/generated apps awaits tracer.flush,
then returns the buffer and provider stats. It is excluded from its own HTTP
instrumentation. An externally supplied jobs exporter need not expose snapshots;
that app returns an empty local span list with the Tracer stats in that case.
Application endpoint access remains host policy. Tests cover overwrite bounds,
copy isolation, exporter close, actual workerd execution and lifecycle flush.
