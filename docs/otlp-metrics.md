# OTLP/HTTP metric exporter

Owner: `OtlpHttpMetricExporter` and `OtlpMetricExportError` from
`@longhorn/observability/otlp-metrics`. Connects the existing [metric registry](metrics.md)
and [reader](metric-reader.md) to a collector through Web Standard Fetch.
[Encoding](otlp-metrics-json.md), [delivery](otlp-delivery.md),
[report integration](jobs-metrics-export.md) and [native proof](otlp-metrics-testing.md)
document the separate boundaries. No Node API or OpenTelemetry SDK is imported.

```ts
import { MetricRegistry, PeriodicMetricReader } from '@longhorn/observability'
import { OtlpHttpMetricExporter } from '@longhorn/observability/otlp-metrics'

const meter = new MetricRegistry()
const exporter = new OtlpHttpMetricExporter({
  endpoint: 'https://collector.example/v1/metrics', serviceName: 'reports',
  resourceAttributes: { 'service.instance.id': instanceId },
})
const reader = new PeriodicMetricReader({ source: meter, exporter })
reader.start()
meter.counter({ name: 'reports_total', help: 'Reports.' }).add(1)
await reader.close()
meter.close()
```

Endpoint is an explicit HTTP(S) signal URL; no suffix, credentials, query, fragment
or environment fallback is inferred. Supply authorization through explicit headers.
`parseOtlpHeaders` is also exported here. Headers/resource metadata are snapshotted
at construction, collection bytes at export admission. Retries reuse exactly those
bytes. Requests omit cookies, disable redirects/cache and require JSON responses.
HTTPS uses the host Fetch certificate policy; no insecure TLS switch is added.

One direct export can be active, with no exporter queue. A second call rejects busy
while an export or timed-out uncooperative Fetch still owns transport work. A reader
serializes normal use. Close drains the accepted batch deadline and is idempotent;
it does not collect by itself. Native Fetch cancellation is tested with real sockets.
An uncooperative custom Fetch keeps admission quarantined until settling, including
after the bounded export promise has timed out; it must honor AbortSignal.

The shared HTTP delivery engine handles traces and metrics with signal-specific
acknowledgements. Metrics inspect `rejectedDataPoints`; partial acceptance is never
retried. Warning-only responses succeed. Permanent status, redirects, malformed
acknowledgements and oversized responses fail without replay. Retryable HTTP
429/502/503/504 and network failures use bounded attempts/backoff within one total
deadline. Ambiguous retries can duplicate collector delivery; cumulative values
are observations, not an exactly-once event stream or durable delivery queue.

Defaults match trace delivery: 10000 ms total deadline (1–60000), three attempts
(1–5), 200/2000 ms initial/max retry delays, 1 MiB request and 64 KiB response.
Metric point capacity defaults to 1000 (1–10000), separately from UTF-8 request bytes.
Stats contain active/pending transports, requests/retries, acknowledged accepted /
rejected data points, failed batches, partial responses, warnings and close state.
They count wire points, including repeated cumulative collections, not business
events. Errors contain stable codes and optional numeric status/rejected metadata;
collector text, endpoint, headers and raw causes are discarded.

Custom labels/resources remain application-owned data. This exporter adds no metric
redaction, automatic OS instrumentation, durable storage, delta temporality,
exemplars, unit inference, log export, Protobuf/gRPC or complete OTel SDK surface.
