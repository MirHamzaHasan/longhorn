# Remote metrics from report jobs

Owner: `examples/jobs/src/config.ts`, diagnostics.ts and `scripts/demo-metrics.mjs`.
Connects [report processing](jobs-example.md), [HTTP/background telemetry](jobs-observability.md),
[metric reader](metric-reader.md), [OTLP metrics](otlp-metrics.md), DI and shutdown.

```sh
pnpm demo:metrics
curl http://127.0.0.1:3014/reports -H 'Content-Type: application/json' -d '{"numbers":[3,7]}'
```

The demo starts an owned native collector and temporary SQLite reports host on
loopback port 3014 (PORT may override). Its sink prints actual forwarded metric
names/point counts every second. Trace export stays in memory. Ctrl+C drains the
host and final metric collection before stopping the collector and removing demo
data. No system service or remote account is modified.

For a collector you provision, configure the existing jobs host and run `pnpm dev:jobs`:

| Environment field | Policy/default |
| --- | --- |
| OTEL_EXPORTER_OTLP_METRICS_ENDPOINT | Required to opt in; exact HTTP(S) signal URL without credentials/query/fragment |
| OTEL_EXPORTER_OTLP_METRICS_HEADERS | Explicit OTEL-style header pairs, empty by default |
| OTEL_EXPORTER_OTLP_METRICS_TIMEOUT | 10000 ms, range 1–60000 |
| OTEL_METRIC_EXPORT_INTERVAL | 60000 ms, range 1–3600000 |
| OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION | Existing service identity, default name longhorn-jobs; version optional |
| OTEL_SERVICE_INSTANCE_ID | Explicit bounded instance identity or a generated per-process UUID |

Metrics and traces select their endpoints/headers/timeouts independently and share
the host's resolved service instance identity. Omitted /
empty metric endpoint creates no reader, timer or remote metric exporter. Invalid
configuration fails before resources are acquired, with field-only diagnostics.
Environment overrides optional .env files. No general endpoint/protocol/temporality
fallback is inferred. Use HTTPS with credentials outside isolated loopback demos.

`resources.metricExporter` can inject a structural exporter, independently of the
existing span exporter. JobsDiagnostics exposes the owned reader. Startup begins
its timer after storage/worker/scheduler initialization. Collection refreshes
background-active/dispatched gauges directly; a Prometheus scrape is unnecessary.
`/metrics` keeps the existing pull format and `/traces` keeps its selected trace mode.
`/diagnostics` adds sanitized metricReader / otlpMetrics counters without exposing
endpoints, credentials, payloads or collector response text.

Collector failure is telemetry failure: readiness and actual persisted report
processing continue. Later collections retain accumulated counts and can recover
without resetting the registry. Shutdown drains HTTP/background work, then tracing
and final metric export before closing the registry. Overall close can include
the current collection plus final batches, each with its own deadline; an external
process deadline can still truncate delivery. The [native gate](otlp-metrics-testing.md)
proves real results, outage/recovery and final forwarded observations.
