# OTLP trace JSON mapping

Owner: the internal otlp-json encoder used by `@longhorn/observability/otlp`.
Connects [SpanRecord](tracing.md), [HTTP export](otlp-http.md) and
[collector roundtrip proofs](otlp-native.md).

One request contains resourceSpans -> resource and scopeSpans -> instrumentation
scope and spans. Resource service.name is required; service.version is optional.
Extra resource attributes cannot replace those reserved keys. The fixed scope is
@longhorn/observability version 0.1.0, matching this package version.

| Framework value | OTLP/JSON value |
| --- | --- |
| traceId / spanId / parentSpanId | Nonzero lowercase hexadecimal strings; no base64 |
| internal / server / producer / consumer | Numeric kinds 1 / 2 / 4 / 5 |
| unset / ok / error status | Numeric code 0 / 1 / 2 |
| sampled | Low trace flag bit 1 or 0 |
| startedAt / endedAt milliseconds | Decimal uint64 nanosecond strings |
| string / boolean attributes | stringValue / boolValue |
| Safe integer numbers | Decimal string intValue |
| Other finite numbers | doubleValue |

Timestamp conversion separates whole milliseconds from the fractional part before
BigInt arithmetic. It never multiplies an epoch millisecond Number into an unsafe
nanosecond Number. The source clock still determines actual precision; a millisecond
clock does not become a nanosecond clock. End must not precede start, and timestamps
must fit uint64. Monotonic durationMs is not substituted for OTLP wall timestamps.

Parentless spans omit parentSpanId. The framework only carries the sampling flag;
unknown parent-remoteness flags stay unset. Names, IDs, kinds, statuses and scalar
attributes are checked before network admission. Each attribute map has at most
32 entries, bounded names and 256-character string values. The resource's 32-entry
bound includes service.name/version. Nonfinite numbers/objects/arrays are rejected.

Batch serialization accounts for UTF-8 bytes incrementally, including the envelope
and separators, and stops at the request limit before processing remaining spans.
The resulting immutable string is reused for retries. Empty batches send no request.
No events, links, exception messages/stacks, tracestate or baggage are invented from
fields absent in SpanRecord.

The wire format follows [OTLP JSON encoding](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding).
The native gate verifies the collector's normalized forwarded records, including
hex IDs, parent hierarchy, exact timestamp strings, numeric enums and typed values.
