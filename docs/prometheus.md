# Prometheus text export

Owner: `@longhorn/observability/prometheus`. Connects [metric snapshots](metrics.md)
to an application-owned pull endpoint.

```ts
app.http.get('/metrics', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  return c.body(renderPrometheus(meter.snapshot()))
})
```

renderPrometheus consumes validated registry snapshots. It emits HELP/TYPE followed
by counter/gauge samples or histogram bucket/sum/count samples. Bucket counts are
cumulative; +Inf equals the total count. Label values escape backslash, quote and
newline; help escapes backslash/newline. Nonempty output ends in a newline. No
sample timestamps are added. The content type is text/plain; version=0.0.4;
charset=utf-8. These conventions follow the [official text format specification](https://prometheus.io/docs/instrumenting/exposition_formats/).

The renderer trusts its snapshot input; it is not a parser/validator for arbitrary
JSON. Registered family/sample names prevent collisions and duplicate series. It
does not implement summaries, native histograms, exemplars, OpenMetrics negotiation,
remote write, scraping configuration or a Prometheus server. The application owns
endpoint access/deployment policy. The demo's metrics are public loopback diagnostics.

HTTP metrics exclude /metrics and /traces in the examples, so a scrape does not add
another series/span for itself. Worker gauges are refreshed synchronously before
the jobs scrape from current process snapshots; durable job counts are not inferred
from those gauges. Native tests request the endpoint and check series, histogram
shape, route normalization, privacy and status totals. Unit tests assert escaping,
cumulative counts, +Inf, final newline and name/series uniqueness boundaries.
