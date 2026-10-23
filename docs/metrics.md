# Portable metrics

Owner: `@longhorn/observability` (`Meter`, `MetricRegistry`). Connects
[HTTP telemetry](http-telemetry.md), [Prometheus export](prometheus.md) and
[background diagnostics](jobs-observability.md).
The optional [reader](metric-reader.md) and [OTLP exporter](otlp-metrics.md) push
the same accumulated values without resetting the source or disabling Prometheus.

```ts
const meter = new MetricRegistry({ maxMetrics: 100, maxSeriesPerMetric: 100, maxTotalSeries: 1000 })
const requests = meter.counter({ name: 'requests_total', help: 'Requests.', labelNames: ['route', 'status'] })
requests.add(1, { route: '/reports/:id', status: '202' })
const active = meter.gauge({ name: 'active', help: 'Active handlers.' })
active.set(2)
const latency = meter.histogram({ name: 'latency_seconds', help: 'Handler latency.', buckets: [0.1, 0.5, 1] })
latency.record(0.25)
const snapshot = meter.snapshot()
meter.close()
```

Meter is a structural provider interface; custom providers implement the same typed
counter/gauge/histogram factories. Label names are fixed at definition and inferred
as a literal tuple. Calls require every declared label and reject extra/missing keys
at runtime too. Values are strings up to 256 characters, with control characters
other than newline rejected. Request/job IDs, account IDs, arbitrary URLs and user
input should not be labels. The HTTP integration supplies bounded templates/methods.

Metric names follow the legacy Prometheus ASCII identifier grammar (max 128 chars).
Help is nonempty, max 1024 characters with escaped newline support. There are at most
16 label names; names follow ASCII label grammar, cannot begin `__`, and histogram
labels cannot use reserved `le`. Registration rejects duplicates and histogram
generated-name collisions (`_bucket`, `_sum`, `_count`), regardless of registration order.

Counter deltas are finite and nonnegative. Gauges accept any finite number.
Histogram observations are finite/nonnegative; up to 64 bucket boundaries must be
finite, nonnegative and strictly ascending. Default seconds-oriented buckets are
0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10. Snapshots include count,
sum and cumulative bucket counts; +Inf is generated during text rendering. These
are doubles, and integer count overflow is rejected. Units are chosen by the caller.

Series are created lazily on the first update; an unobserved family has no samples.
Limits default to 100 definitions, 100 label combinations per metric and 1000 total
combinations. Configured limits are positive safe integers up to 100000. Overflow
throws MetricLimitError; existing series can still update. Cardinality is bounded
in label combinations, not rendered histogram sample lines. The size of strings,
labels and buckets is bounded separately. There is no automatic eviction/reset.

Snapshots deeply detach family metadata, labels and bucket arrays. stats exposes
definition/series counts and closed state. close is synchronous/idempotent; later
registration/updates throw MetricsClosedError, while final snapshots remain readable.
This registry is application/process/isolate-local and resets on restart. It does
not scrape OS metrics or persist values. `collect()` adds a fixed registry start
and current epoch-millisecond collection time to a detached snapshot. Optional
`now` injection supports deterministic hosts/tests; invalid/negative/noninteger
clock results reject, and backward clocks clamp to the previous collection time.
Final collections remain readable after close. An explicitly selected reader /
exporter owns remote delivery; no network/timer is installed by the registry.

Strict API errors reach direct callers; [HTTP/background wrappers](http-telemetry.md)
isolate recording failures from business results. Tests cover aggregation, invalid
transitions, labels/types, capacities, name collisions, snapshot isolation and close.
