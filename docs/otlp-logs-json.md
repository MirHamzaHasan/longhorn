# Log records in OTLP/JSON

Owner: `packages/observability/src/log-record.ts` and the encoder inside otlp-logs.ts.
Connects [normalized logger records](logging.md), [buffered entries](log-processing.md)
and [OTLP log delivery](otlp-logs.md). Resource/scope/timestamp helpers are shared
with traces and metrics.

| LongHorn input | OTLP field |
| --- | --- |
| Canonical ISO timestamp | timeUnixNano decimal string |
| Observed epoch milliseconds | observedTimeUnixNano decimal string |
| debug / info / warn / error | Numeric severities 5 / 9 / 13 / 17 and uppercase text |
| Message | Body stringValue |
| Normalized fields | Attributes with recursive AnyValue encoding |
| Explicit SpanContext | Hex traceId/spanId and sampled flag |

Safe integer values become decimal intValue strings; other finite numbers become
doubleValue, booleans boolValue, strings stringValue. Arrays and objects retain
their nested arrayValue / kvlistValue shapes. Null maps to an empty AnyValue. JSON
semantics normalize negative zero and shared-reference identity. No schema vendor,
automatic exception semantic conversion or inferred context is introduced.

The event timestamp must be the canonical ISO form produced by Date.toISOString.
Observed time can include fractional milliseconds; both clocks must be finite /
nonnegative and fit the supported epoch range through 18446744073709 ms. Event
and observed times need not be ordered because their clocks can differ. Context
requires nonzero lowercase 16-byte trace / 8-byte span IDs plus a boolean sampled
flag. Missing context stays missing, rather than inventing a span.

Admission copies only data properties without executing getters/toJSON. It accepts
plain objects, dense arrays, valid Unicode, finite numbers and normalized LogValue
shapes. Cycles, accessors, unsupported prototypes/symbols, non-enumerable properties,
sparse arrays and unpaired surrogates reject. A whole entry is bounded at 512 nodes
and depth 10, including its record wrapper; fields have at most 32 keys, nested
objects 64, arrays 256 and key names 128 characters. The logger's earlier source
normalization can still invoke source accessors; this check applies to supplied
normalized records. Strings/encoded entries have the configured byte cap.

Every request uses resourceLogs / scopeLogs / logRecords with the framework scope.
The final UTF-8 wire budget includes the resource envelope, attribute wrappers and
all entries. Records are encoded before network admission; malformed/oversized input
cannot send a partial request. Retry uses the same serialized bytes.

The mapping follows the official [log schema](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.9.0/opentelemetry/proto/logs/v1/logs.proto)
and [AnyValue model](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.9.0/opentelemetry/proto/common/v1/common.proto).
[Native proof](otlp-logs-testing.md) inspects the real collector's normalized values.
