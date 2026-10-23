# HTTP telemetry middleware

Owner: `@longhorn/observability/hono`. Connects Hono to the portable [Meter](metrics.md),
[TraceProvider](tracing.md), [health handlers](health-checks.md) and [request logs](logging.md).
It imports Hono directly, without a core dependency.

```ts
const http = httpTelemetry({ meter, tracer, excludePaths: ['/metrics', '/traces'] })
app.http.use('*', http.middleware) // before application routes/middleware to observe
app.http.use('*', async (c, next) => {
  const span = requestSpan(c)
  if (span) c.set('logger', c.get('logger').child({ traceId: span.context.traceId, spanId: span.context.spanId }))
  await next()
})
```

It records longhorn_http_requests_total (method/route/status),
longhorn_http_request_duration_seconds (method/route histogram), and
longhorn_http_requests_active (gauge). These families register once at configuration;
using multiple middleware instances with one registry requires distinct registries
or an application-owned naming strategy. Invalid/duplicate setup fails immediately.
Runtime recording errors increment http.snapshot().errors, invoke optional synchronous onError,
and leave business responses intact even if that observer also throws.

Methods outside a fixed standard-method set become OTHER. Labels use registered
Hono route templates, up to 240 characters, rather than c.req.path. Unmatched and
wildcard-only middleware matches share _unmatched. Concrete/parameter ALL routes
are supported. Long/unrecognized templates use the same fallback. IDs, unknown raw
paths, query strings, bodies and header values never become metric labels or default
span attributes. Registry bounds additionally limit series growth. Custom applications
that register dynamic route templates still own that registration/cardinality policy.

Timing ends when Hono's handler/middleware finishes producing the response, before
stream transmission completes. Errors/validation responses use the final status;
unexpected escaping exceptions record 500 before rethrowing. Server spans use method
and template for names, and method/route/status attributes. 5xx status marks error;
other statuses mark ok. No exception text/stack is recorded in default spans.

A validated incoming traceparent becomes the explicit parent; invalid/duplicate
values start a new root. The current server context is available through requestSpan(c)
or the optional TelemetryEnv variable and returned as a traceparent response header.
This response header is a LongHorn correlation convenience. Use context helpers to
inject outbound headers deliberately; no fetch instrumentation is installed.
No tracestate/baggage or arbitrary headers are persisted.

The example logger enrichment is application middleware. Core's request logger uses
the current child logger for completion, so enriched trace/span fields accompany
request IDs. Core still does not import a tracing package. Existing logging privacy
and error serialization remain separate from telemetry's safe defaults.

Excluded paths still execute normally through Hono/core logs; telemetry skips both
metrics and spans. The examples exclude diagnostic snapshot/scrape endpoints to
avoid self-observation. The wrapper owns no timers/exporter and does not close
providers; drain HTTP first, then resources and tracing. Unit/native/project gates
cover errors, ALL routes, route normalization, exclusions, IDs, privacy and failures.
