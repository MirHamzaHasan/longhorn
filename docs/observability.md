# Observability

Owner: `@longhorn/observability`. Connects [health checks](health-checks.md),
[metrics](metrics.md), [Prometheus text](prometheus.md), [tracing](tracing.md),
[memory span export](memory-traces.md), [HTTP telemetry](http-telemetry.md),
[logging](logging.md), [lifecycle](lifecycle.md), and [report diagnostics](jobs-observability.md).
An opt-in [OTLP/HTTP exporter](otlp-http.md) connects the same tracing contract to a collector.
An independent [metric exporter](otlp-metrics.md) connects cumulative collections
through a lifecycle-owned [reader](metric-reader.md).
An independent [log exporter](otlp-logs.md) connects the synchronous logger through
a bounded [processor](log-processing.md) and explicit [sink fanout](logger-sinks.md).
The root entrypoint imports no HTTP implementation, Node APIs or backend SDK.
Core does not depend on observability: applications opt in through DI/middleware.

| Entry point | Provides | Ownership |
| --- | --- | --- |
| `@longhorn/observability` | Readiness, Meter/MetricRegistry, TraceProvider/Tracer, context helpers | Explicit application services |
| `/hono` | HTTP metrics/spans, readiness/liveness handlers, requestSpan | Application HTTP middleware |
| `/prometheus` | Exposition renderer and content type | Pull from registry snapshots |
| `/memory` | Bounded MemorySpanExporter | Exclusively owned by one Tracer |
| `/otlp` | Bounded OTLP/HTTP trace exporter | Exclusively owned by one Tracer |
| `/otlp-metrics` | Bounded OTLP/HTTP cumulative metric exporter | Exclusively owned by one metric reader |
| `/otlp-logs` | Bounded OTLP/HTTP log exporter | Exclusively owned by one log processor |

The jobs example registers JobsDiagnostics through DI. Readiness checks run only
when probed; dependencies determine ready/unready, while liveness has an independent
predicate. Timing/worker diagnostics are observations of the current process.
Metrics and traces are bounded, reset on restart, and do not become durable state.
Queue/schedule state remains in SQLite. Portable/generated apps use the same
instrumentation with an explicit application-state check instead of a database check.

Metric updates and trace export failures do not replace business responses. The
strict low-level APIs report invalid configuration/recording calls; HTTP wrappers
and Tracer.trace isolate telemetry failures. Export is serial and best-effort, with
bounded queues and dropped/error counters. The root provider installs no network
transport itself; [OTLP delivery](otlp-delivery.md) supplies bounded transport retries
when explicitly selected. The metric reader adds explicit periodic push without
resetting the registry. No OpenTelemetry SDK, automatic outbound instrumentation
or global asynchronous context is supplied.

The default HTTP data includes method, registered route template, numeric status,
handler duration, and trace IDs. It omits body, query, header values, raw dynamic
paths, exception messages and stacks. Explicit custom labels/attributes/exporters
remain application-owned. Existing request logging still includes URL paths and
explicitly logged errors; its separate [logging policy](logging.md) is unchanged.

Shutdown first drains HTTP and readiness dependency work, then background resources
and storage. Final trace and metric drain/export happen before the registry closes.
The jobs host can mark unready during a configured pre-close grace interval. A
selected log processor closes last after diagnostics, including final application
records; the [host guide](jobs-logs-export.md) records projection and failure policy. A
Workers isolate owns its lifetime; bounded in-memory export does not imply a final
platform flush or delivery guarantee.

`pnpm test:observability` executes built behavior on Node/Bun/Deno/workerd and real
HTTP, including dependency failure/recovery, stuck checks, privacy, trace hierarchy,
export failure isolation, pre-close readiness and exporter cleanup. Runtime/project
gates exercise the portable example and independently installed generated starters.
Each constituent feature has its own linked guide above.
