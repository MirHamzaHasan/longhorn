# Owned periodic metric collection

Owner: `PeriodicMetricReader` and `MetricReaderError` from `@longhorn/observability`.
Connects [cumulative collections](metrics.md), the structural `MetricSource` /
`MetricExporter` contracts, [OTLP export](otlp-metrics.md) and application lifecycle.
It imports no HTTP, native API or exporter implementation.

```ts
const reader = new PeriodicMetricReader({
  source: meter, exporter, intervalMs: 60000, maxDataPointsPerBatch: 1000,
  onError: error => logger.warn('Metric collection failed', { operation: error.operation }),
})
reader.start()           // explicit; construction creates no timer
await reader.flush()    // also works without start, e.g. inside a Worker request
await reader.close()    // final collection, then owned exporter close
meter.close()
```

The first automatic collection happens after the interval. Ticks schedule from
completion, without overlapping exports or accumulating missed intervals. One
source collection is split into serial data-point batches, including splitting a
large family, before another collection begins. All its batches keep the original
start/collection times. Export is cumulative; successful delivery does not reset
the source. Empty families produce no export call.

`flush()` requests a current collection. Concurrent requests coalesce. A request
arriving during an export schedules a fresh collection behind it, so updates made
after the active snapshot are not lost. Callers share the active drain promise;
any failure during that drain rejects those explicit flush callers. Only scalar
pending demand is retained, not a queue of old snapshots. There is one iterator
over the current collection and at most one accepted export.

Close rejects new flush/start calls, cancels the timer, requests a final fresh
collection behind accepted work and closes the exporter once. A failed final
collection/export is reported through counters/onError and remains best effort.
An exporter close failure rejects with a sanitized `MetricReaderError('close')`;
state still becomes closed. Calls to close return the same promise. Stop producers
before close when their final observations must be included. Sources/exporters
must settle and must not await their own reader's close from an accepted operation.
Custom providers do not acquire a forced-cancellation guarantee from the reader;
the [OTLP transport](otlp-delivery.md) supplies per-batch deadlines.

Defaults: 60000 ms interval (1–3600000), 1000 points per batch (1–10000), 10000
points per collection (1–100000). A collection has at most 10000 families; oversized
collections reject before the first export. Registry cardinality limits apply
before collection. Request-byte limits remain separate: choose compatible reader
batch sizes and exporter caps for large label sets. The caller exclusively owns
the source; its returned collection must remain stable during the drain.

Stats contain state, active/queued demand, attempted collections/batches,
failed collections and fully acknowledged exported data points. Partial acceptance
conservatively counts that batch as failed here; the exporter separately reports
accepted/rejected point counts. Failures expose only collect/export/close/closed
operation codes. The synchronous onError callback is isolated from reader progress.
Tests cover timers, splitting, flush races, final updates, failures, bounds and
close; [native proof](otlp-metrics-testing.md) verifies the working host.
