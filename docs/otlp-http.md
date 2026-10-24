# OTLP/HTTP trace exporter

Owner: OtlpHttpSpanExporter from `@longhorn/observability/otlp`. Connects the existing
[Tracer](tracing.md) and SpanExporter contract to a collector through Web Standard
Fetch. [Encoding](otlp-json.md), [delivery](otlp-delivery.md), [configuration](otlp-configuration.md),
[report integration](jobs-otlp.md) and [native verification](otlp-native.md) have separate guides.
The entrypoint imports no Node APIs, native driver or OpenTelemetry SDK.

```ts
import { Tracer } from '@longhorn/observability'
import { OtlpHttpSpanExporter } from '@longhorn/observability/otlp'

const exporter = new OtlpHttpSpanExporter({
  endpoint: 'http://127.0.0.1:4318/v1/traces',
  serviceName: 'reports', serviceVersion: '1.0.0',
  resourceAttributes: { 'deployment.environment.name': 'development' },
  timeoutMs: 10000,
})
const tracer = new Tracer({ exporter })
await tracer.trace('reports.generate', () => generateReport(), { kind: 'consumer' })
await tracer.close()
```

Endpoint is an explicit HTTP(S) signal URL. No /v1/traces suffix is added and no
ambient environment variables are read by the library. URL credentials, query and
fragment are rejected. HTTPS uses the host Fetch implementation's certificate policy;
this exporter provides no insecure TLS switch, certificate file reader or gRPC transport.
Headers can supply explicit server authorization. Requests omit browser cookies,
disable redirects and caching, and use application/json for content type/accept.

serviceName is required; serviceVersion/resourceAttributes are optional. The resource
and headers are snapshotted during construction; the batch is serialized synchronously
at admission, so later caller mutation cannot change accepted bytes or retries.
Each request includes the framework's instrumentation scope. Resource/attribute and
request bounds are described in the encoding/delivery guides.

Tracer owns the exporter exclusively and serializes export calls. The exporter adds
no queue or interval: a second direct export while work/transport remains active
rejects busy. Normal application spans end without waiting on network I/O. Existing
Tracer active/queue/batch limits and best-effort error isolation remain in force.

stats exposes only active/pending transport counts, requests/retries, acknowledged
accepted/rejected spans, failed batches, partial responses, warnings and close state.
It contains no endpoint, header values, span data or collector messages. OtlpExportError
exposes a stable code and optional numeric HTTP/rejection metadata. Raw transport
causes and response bodies are discarded, rather than becoming log fields.

Custom attributes/resource values are still application-owned data: this transport
does not redact arbitrary payloads. The default HTTP instrumentation uses route
templates and omits bodies/cookies/exception text. Supply an uninstrumented custom
Fetch if other tooling would recursively trace the exporter itself.

This implementation exports the framework's trace record model through OTLP/JSON.
It does not install automatic instrumentation, global context, metric/log export,
Protobuf/gRPC, compression or the full OpenTelemetry SDK environment surface.
Metrics use the separate [metric exporter and reader](otlp-metrics.md); logs use
the separate [log exporter and buffer](otlp-logs.md).
Real collector interoperability is verified across [all four runtimes](otlp-native.md).
