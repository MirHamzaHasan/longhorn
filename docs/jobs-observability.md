# Report observability wiring

Owner: `examples/jobs/src/diagnostics.ts`. Connects [report jobs](jobs-example.md),
[schedules](scheduled-reports.md), [health](health-checks.md), [metrics](metrics.md),
[tracing](tracing.md), [HTTP telemetry](http-telemetry.md), [logging](logging.md) and
[lifecycle](lifecycle.md). JobsDiagnostics is the DI token for application services.

```sh
pnpm dev:jobs
curl http://127.0.0.1:3002/livez
curl http://127.0.0.1:3002/readyz
curl http://127.0.0.1:3002/metrics
curl http://127.0.0.1:3002/traces
curl http://127.0.0.1:3002/diagnostics
```

/livez describes application liveness. /readyz awaits SELECT 1 on the acquired SQL
connection and checks the state of each configured worker/runner. It returns 200
or 503 without exception details. Disabled components are deliberately omitted from
readiness: a producer-only host can be ready to enqueue. Historical provider error
counts do not permanently fail readiness after recovery. This checks connectivity
and configured component state, not backlog latency or an external service SLA.
/health retains its earlier informational/config-flag response.

/metrics exposes HTTP counters, active handlers, duration buckets, current worker/
scheduler active gauges, process-runner dispatch count, background operational error
counts and report handler outcomes. `returned`/`threw` counts describe the handler
before queue acknowledgement; returned does not imply a committed success transition
or exclusive execution. Background counts reset on restart, while durable queue/
schedule records persist. Gauge refresh happens synchronously before a scrape.

/traces flushes completed exports and returns the last 128 local records plus
Tracer stats. HTTP and enqueue producer spans share explicit context; worker
consumer spans are independent roots because the queue does not persist trace
context. Consumer attributes are queue name/attempt, without job ID or report data.
Raw numbers, query values, dynamic IDs and exception details are absent from default
telemetry. Custom injected exporters can replace local retention. Export/observer
failures are logged with fixed component metadata and do not fail report work.

/diagnostics returns current readiness phase/active check count, metric capacity
usage, tracer/http diagnostic counters, and worker/runner state. It includes no
stored job payloads. Diagnostic endpoints are public loopback examples. /metrics,
/traces and /diagnostics exclude themselves from HTTP metrics/spans; core logging
still runs. Readiness/diagnostic responses use no-store.

Startup acquires DB -> Queue -> Scheduler -> Worker -> Runner -> Readiness. Cleanup
drains HTTP -> Readiness underlying checks -> Runner -> Worker -> Scheduler -> Queue
-> DB, then final onStop closes tracing/exporter and metrics. Even a timed-out SQL
check keeps its underlying slot until settled, so dependencies outlive accepted
health operations. Final trace export can observe completed background attempts.
Startup rollback and closing an app that never started also close telemetry services.

The Node host calls beginDrain on signals before app.close. SHUTDOWN_GRACE_MS
(decimal string, 0–10000, default 0) optionally keeps the listener alive briefly
with /readyz=503 and /livez=200 before normal HTTP draining. It is a pre-close
traffic-removal window, not a forceful handler/export timeout. Business requests
can still finish/arrive during this window. Multiple shutdown signals share cleanup.

Portable/generated examples use the same portable interfaces with an application
state check, fixed HTTP labels and bounded local span export. They have no SQL or
background readiness check. Workers owns isolate termination, so no final flush
is promised there. Native snapshot counters reset at each new process/isolate.

Unit tests verify unhealthy SQL, unexpected worker stop, output privacy, exporter
failure isolation, enriched logs and readiness-before-DB / tracing-after-DB cleanup.
`pnpm test:observability` executes built contracts across runtime targets and compiled
HTTP, including failure/recovery and signal drain. All QA uses temporary databases.

[Remote OTLP tracing](jobs-otlp.md) can replace the default memory exporter through
explicit host settings. Its sanitized transport counters appear in diagnostics,
collector failure stays outside dependency readiness, and final Tracer.close drains
accepted delivery before process exit. No endpoint keeps the local behavior above.
