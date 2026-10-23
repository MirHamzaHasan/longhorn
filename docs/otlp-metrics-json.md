# Cumulative metric OTLP/JSON encoding

Owner: `packages/observability/src/otlp-metrics-json.ts`. Connects
[MetricCollection](metrics.md) to the [metric exporter](otlp-metrics.md) while
sharing resource/scope and nanosecond encoding with [traces](otlp-json.md).

`MetricRegistry.collect()` returns detached metrics plus one registry `startedAt`
and current `collectedAt`, in epoch milliseconds. Start identity stays fixed for
the registry lifetime. A backward wall clock is clamped to the previous collection
time; an invalid clock rejects. Final collections remain readable after registry
close. A new registry has a new accumulation period; observations are not restored
after restart. Concurrent hosts need distinct resource instance identities.

| Registry kind | OTLP representation |
| --- | --- |
| Counter | Monotonic Sum, cumulative temporality (numeric enum 2), `asDouble` |
| Gauge | Gauge with signed finite `asDouble` and collection time |
| Histogram | Cumulative Histogram, count/sum, explicit bounds and disjoint bucket counts |

For histogram cumulative buckets `[1, 2, 3]` and count 4, OTLP receives
`["1", "1", "1", "1"]`: differences plus the final +Inf remainder. Bounds remain
`[0, 1, 2]` in that example. Count/bucket counts and nanosecond timestamps are decimal
strings; durations/values/sums/bounds are JSON numbers. Number points use doubles
consistently. Counter/histogram points carry the registry start and collection
time; gauges carry collection time only. Metric names/descriptions are preserved;
no unit or suffix rewriting, fabricated extrema or exemplars are added.

Each label combination is one data point with string-valued attributes, including
valid Unicode. Resource attributes retain the trace exporter's scalar encoding.
Empty families are omitted. Names/labels/finite values, unique families/series,
timestamps, nonnegative counters, safe histogram counts and ascending cumulative
buckets are validated before I/O. Sparse arrays and unpaired Unicode surrogates
reject. The serializer emits resourceMetrics/scopeMetrics with the framework scope.

UTF-8 bytes are counted incrementally across the whole envelope, family metadata
and points. Point capacity is distinct from request bytes. Up to 10000 families,
16 labels, 64 explicit bounds and the existing registry text limits are accepted;
configured registry cardinality bounds remain independent. No partial local batch
is sent after an encoding failure. The reader can split large point collections;
it does not automatically split by encoded byte size.

The mapping follows the official [OTLP metric data model](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.9.0/opentelemetry/proto/metrics/v1/metrics.proto)
and [JSON transport rules](https://opentelemetry.io/docs/specs/otlp/).
[Native tests](otlp-metrics-testing.md) inspect the real collector's normalized
forwarded points, including repeated cumulative timestamps and bucket counts.
