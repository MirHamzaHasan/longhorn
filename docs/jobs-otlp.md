# Remote traces from report jobs

Owner: examples/jobs/src/config.ts and diagnostics.ts. Connects [report processing](jobs-example.md),
[background instrumentation](jobs-observability.md), [OTLP configuration](otlp-configuration.md),
[export lifetime](otlp-delivery.md), DI and application shutdown.

```sh
pnpm demo:tracing
curl http://127.0.0.1:3004/reports -H 'Content-Type: application/json' -d '{"numbers":[3,7]}'
```

The demo creates a temporary native collector and SQLite report app at loopback
port 3004 (PORT can override it). The collector forwards normalized JSON into an
owned local sink. Console summaries show received span names/counts. Ctrl+C drains
the app before stopping the collector and removes demo database/config files. It
does not install a system service or write to a remote account.

For a collector you provision, set the explicit trace endpoint/header settings in
the configuration guide and run dev:jobs. No endpoint means the previous local memory
buffer remains active. The configured exporter supplies the same Tracer to HTTP
middleware, reports.enqueue producer spans and reports.process consumer spans.
Workers keep their lifecycle-owned queue/handler behavior; export does not block
request completion or turn telemetry into a database dependency.

HTTP spans use route templates and preserve explicit traceparent correlation.
Background attributes contain queue name/attempt, not payloads or job IDs. There is
no automatic durable parent propagation through queue payloads. Custom attributes
remain application-owned; no universal redaction policy is claimed.

GET /diagnostics adds an otlp object of sanitized exporter counters when remote mode
is selected. It exposes no endpoint/header values. GET /traces flushes the tracer;
remote mode returns an empty spans array plus local tracer counters because it does
not also retain a memory copy. Memory mode keeps its existing span snapshots. These
development diagnostic routes are excluded from their own tracing.

Collector failure increments exporter/tracer counters and emits a generic warning.
Readiness still measures database/worker/scheduler state, and business operations
continue. Shutdown drains HTTP and background resources before final tracer.close;
that closes active spans, bounded queued exports and the exporter. Each queued batch
has its own deadline, so a large queue/outage can extend overall host drain time.
An external process/isolate deadline can still truncate final delivery.

[Native verification](otlp-native.md) proves real report results, server/producer/
consumer collector spans, input/credential exclusion, simulated collector outage,
readiness separation and graceful process exit.
