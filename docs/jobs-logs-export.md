# Remote logs from report jobs

Owner: `examples/jobs/src/logging.ts`, config.ts, app.ts and `scripts/demo-logs.mjs`.
Connects [structured logging](logging.md), [local fanout](logger-sinks.md),
[owned buffering](log-processing.md), [OTLP logs](otlp-logs.md), existing DI,
HTTP/background work and application shutdown.

```sh
pnpm demo:logs
curl http://127.0.0.1:3015/reports -H 'Content-Type: application/json' -d '{"numbers":[3,7]}'
```

The demo creates its own native collector and temporary SQLite reports host on
loopback port 3015 (PORT may override). The sink prints real normalized log events
received through the collector. Local console output stays active, while trace /
metric network export is disabled for this isolated demo. Ctrl+C drains the host
and final logs before stopping the collector and removing temporary data.

For an owned collector, set these fields and run `pnpm dev:jobs`:

| Setting | Policy/default |
| --- | --- |
| OTEL_EXPORTER_OTLP_LOGS_ENDPOINT | Exact explicit HTTP(S) log signal URL; omitted/empty disables remote logs |
| OTEL_EXPORTER_OTLP_LOGS_HEADERS | Explicit OTEL-style header pairs; empty default |
| OTEL_EXPORTER_OTLP_LOGS_TIMEOUT | 10000 ms, range 1–60000 |
| OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION | Existing host identity; version optional |
| OTEL_SERVICE_INSTANCE_ID | Shared across selected signals; generated per-process UUID if omitted |

All signals select endpoint/headers/deadline independently. Configuration is checked
before resource acquisition. The log profile creates no reader timer: records
enter the bounded processor through a synchronous sink. Without an endpoint the
CLI keeps the existing local logger and no remote processor. A directly created
jobs app selects this profile when configured; an explicit custom logger overrides
that automatic selection and its owner supplies any processor separately.

`createJobsLogging` composes local console plus remote projection. Remote fields
are app, method, status, durationMs, traceId, spanId, traceSampled, component and
operation. Raw paths, request IDs, arbitrary fields, logged error objects and
listening URLs stay out of that projection. Messages remain application-owned;
this is not general text redaction. Local output keeps its existing full fields
and standard sensitive-key redaction. Export errors use a separate local logger,
so an unavailable collector does not recursively log its own failures remotely.

HTTP middleware attaches explicit server-generated trace IDs and sampling state.
The host validates those fields before passing a SpanContext to the processor;
native tests match exported log context to actual retained spans. It does not
trust incoming request IDs or derive trace context from arbitrary library fields.
The log endpoint can coexist with memory or remote tracing and metric push.

The app registers final processor close before its other stop hooks, making it
run last after HTTP/background resources and diagnostics stop. This includes the
host's Application stopped record. Startup rollback follows the same ownership.
Post-close startup/shutdown error reporting remains local. `/diagnostics` exposes
only processor counters; collector failure does not affect readiness or persisted
report results. Logs are best effort, bounded and process-local until acknowledged;
they are not retained for crash replay. [Native proof](otlp-logs-testing.md) covers
outage/recovery, privacy projection, correlation and final drain.
