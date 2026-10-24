# Explicit OTLP configuration

Owner: exporter options and parseOtlpHeaders in `@longhorn/observability/otlp`, with
environment selection in examples/jobs/src/config.ts. Connects [typed config](configuration.md),
[transport](otlp-http.md), [delivery bounds](otlp-delivery.md) and [the app](jobs-otlp.md).

The library reads no environment or files. A host supplies endpoint, serviceName,
optional serviceVersion/resourceAttributes, headers and delivery options. Endpoint is
the exact signal URL; there is no automatic base-URL suffix or ambient exporter.
Only HTTP(S), host, port and path are accepted. URL credentials/query/hash are rejected;
authorization belongs in explicitly provided headers.

parseOtlpHeaders accepts a comma-separated key=value string, trims pair whitespace,
and percent-decodes values. Split occurs at the first equals sign, so encoded/raw
equals inside values remain part of a value. Empty input produces an empty frozen
record. Duplicate case-insensitive names, malformed escapes, semicolon metadata,
control/non-ASCII header values and framing/cookie/hop-by-hop overrides are rejected.
Names/values are bounded to 128/4096 characters and at most 32 entries; parser input
is at most 65536 characters. Content-Type/Accept are owned by the exporter. Headers
are snapshotted and never included in stats/errors.

```sh
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer%20your-token
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT=10000
OTEL_SERVICE_NAME=longhorn-jobs
OTEL_SERVICE_VERSION=1.0.0
pnpm dev:jobs
```

The jobs example supports these specific settings. Endpoint omitted/empty keeps
the existing memory exporter. Timeout is milliseconds, default 10000 (1–60000).
Service name defaults to longhorn-jobs; version is optional. The jobs host resolves a per-process service instance UUID
(or explicit OTEL_SERVICE_INSTANCE_ID) and shares it across selected trace/metric
exporters. Metric endpoint, headers, timeout and collection interval are independently
opted in through the [metric host guide](jobs-metrics-export.md). Empty optional/default
environment values act as unset. Process environment overrides optional .env files.
Invalid header/endpoint configuration fails through field-only ConfigError messages.
An explicitly injected resources.exporter overrides host selection for applications/tests.
The [log host profile](jobs-logs-export.md) adds independent LOGS_ENDPOINT /
LOGS_HEADERS / LOGS_TIMEOUT fields with the full OTEL_EXPORTER_OTLP_ prefix. It
shares the service instance identity and retains console output; the logger itself
does not read environment configuration.

This is a deliberate host configuration surface, not full OpenTelemetry SDK config.
OTEL_EXPORTER_OTLP_ENDPOINT, protocol/gzip/gRPC settings, automatic resource detection,
certificate files and general/signal fallback precedence are not implemented. Configure
programmatic Fetch/TLS behavior through the owning host when needed. Use HTTPS for a
remote collector with credentials; local native demos use isolated loopback HTTP.

See [OpenTelemetry exporter configuration](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
for the wider standard and [native proofs](otlp-native.md) for supported runtime behavior.
