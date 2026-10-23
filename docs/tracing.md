# Explicit-context tracing

Owner: `@longhorn/observability` (`TraceProvider`, `Tracer`, `SpanExporter`). Connects
[HTTP instrumentation](http-telemetry.md), [memory export](memory-traces.md),
[logging](logging.md), [lifecycle](lifecycle.md) and [report work](jobs-observability.md).

```ts
const tracer = new Tracer({ exporter: new MemorySpanExporter() })
const parent = requestSpan(c)?.context
const span = tracer.startSpan('reports.enqueue', { kind: 'producer', ...(parent ? { parent } : {}) })
try { await enqueueReport(); span.setStatus('ok') }
catch (error) { span.setStatus('error'); throw error }
finally { span.end() }
// Or isolate telemetry failures while preserving the business result/error:
await tracer.trace('reports.process', async (span) => processReport(), { kind: 'consumer' })
await tracer.flush()
await tracer.close()
```

A context contains nonzero lowercase
32-hex traceId, 16-hex spanId, and a sampled boolean. Span contexts are frozen;
parent/options attributes are snapshotted. Child spans receive the same trace ID
and a new span ID. Pass parents explicitly; there is no global AsyncLocalStorage,
automatic Promise context, fetch wrapper or implicit queue context propagation.

parseTraceparent accepts the standard common prefix, rejects zero/invalid IDs,
uppercase hex, ff versions, duplicate comma-joined headers and values beyond 512
characters. Version 00 must be exactly its base format. Future versions can carry
a hyphen-delimited extension, which is ignored. Only the sampling bit is retained;
formatTraceparent emits version 00 and clears other flags. tracestate and baggage
are not collected or forwarded. See the [W3C Trace Context specification](https://www.w3.org/TR/trace-context/).

Tracer root sampleRate defaults to 1 (0–1). Roots sample from generated trace ID
bits; children inherit a valid parent's sampled decision, including remote parents.
A caller's trace IDs/sampling are correlation hints, not authentication/trust. Active
and queue bounds limit recording even for sampled parents. Unsampled/over-capacity
spans still supply context but are not exported. Incoming sampled=false can therefore
produce correlated logs/response headers without a stored span.

Names are nonempty, max 256 characters without control characters. Kinds are internal,
server, producer, consumer. A recorded span supports up to 32 scalar attributes with
bounded names/strings and finite numbers. Custom attributes are application-owned;
HTTP defaults exclude request data/error details. setName/setStatus after end do
nothing; end is idempotent. Wall-clock start/end times and monotonic handler duration
are captured. A backward wall/monotonic clock is clamped so duration is nonnegative.

The structural TraceProvider contract supplies startSpan. Exporters implement async
export(batch) and close(). Tracer exclusively owns one exporter and serializes calls.
Defaults bound recording to 128 active spans, 256 queued completed spans, and export
batches of 64; each configured bound is 1–100000. The in-flight batch is additional
to the completed queue. Active overflow and full queues drop new records. Export
runs asynchronously after span end and never blocks the handler on network work.

Export failures drop that batch, increment exportErrors/dropped, and notify optional
synchronous onError. A throwing observer increments instrumentationErrors. There is no automatic
retry, deadline or second concurrent exporter call. A stalled exporter holds one
in-flight batch and bounded pending records; its provider must implement I/O timeouts.
snapshot exposes active/queued/exported/dropped/error counts and terminal closed state.

startSpan/Span setters are strict APIs. Tracer.trace catches start/end failures so
the callback still runs and its result or original thrown value is preserved. It
passes undefined when no span can start. Explicit invalid span operations inside
the business callback are still callback errors; use safe, known attributes.
The default record stores status, not exception messages/stacks.

flush waits for queued/in-flight exports, not active spans. Concurrent traffic can
extend it; call it at a quiescent boundary when a full drain is required. close
stops new spans, waits for active **recording** spans to end, drains exports, then
closes the exporter. It memoizes its promise and becomes terminal even on exporter
close failure, which rejects as TraceExporterError. Never await close from an active
span it is waiting for. Hung spans/exporters keep close pending; host deadlines are
separate. trace() remains best-effort after close, while startSpan throws.

This remains a portable tracing interface/provider rather than an OpenTelemetry SDK.
Choose the separate [OTLP/HTTP exporter](otlp-http.md) for collector delivery; it does
not replace Tracer queue/context ownership. Final Workers isolate delivery is not guaranteed. Unit/native
tests cover contexts, parent isolation, sampling, bounds, serial export, failures,
business error preservation, clocks, snapshot isolation and drain/cleanup errors.
