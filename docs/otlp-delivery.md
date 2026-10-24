# OTLP delivery and lifetime

Owner: shared `OtlpHttpDelivery` internals, used by OtlpHttpSpanExporter and
OtlpHttpMetricExporter / OtlpHttpLogExporter. Connects [Tracer queue ownership](tracing.md),
[metric reader ownership](metric-reader.md), [trace encoding](otlp-json.md),
[metric encoding](otlp-metrics-json.md), [configuration](otlp-configuration.md) and
[native trace](otlp-native.md), [metric tests](otlp-metrics-testing.md) and
[buffered log delivery](otlp-logs.md).

| Option | Default | Allowed |
| --- | --- | --- |
| timeoutMs | 10000 | 1–60000 ms |
| maxAttempts | 3 | 1–5, including initial request |
| initialRetryDelayMs | 200 | 1–60000 ms |
| maxRetryDelayMs | 2000 | initial delay–60000 ms |
| maxSpansPerBatch | 256 | 1–10000 |
| maxDataPointsPerBatch (metric exporter) | 1000 | 1–10000 |
| maxLogRecordsPerBatch (log exporter) | 128 | 1–10000 |
| maxRequestBytes | 1048576 | 256–16777216 |
| maxResponseBytes | 65536 | 1–4194304 |

One batch deadline starts after bounded synchronous serialization and covers Fetch,
response reading and retry waits. A shared AbortController cancels network/body work
when it expires. Requests are serial; retry delays use capped exponential backoff
with 50–100% jitter. Retry-After seconds or HTTP dates establish a minimum delay.
If the next delay cannot fit in the remaining budget, the batch fails immediately
with timeout instead of sleeping past it.

Network disconnection and HTTP 429/502/503/504 can retry the exact same payload.
Other error statuses, redirects, invalid acknowledgements, oversized responses and
partial acceptance never retry. Attempts also stop at maxAttempts. Error bodies are
cancelled without copying their diagnostic text. Successful JSON responses are read
through a byte-limited stream, counting decompressed bytes; malformed JSON/content
types or invalid rejection counts fail as protocol errors.

HTTP 200 with an empty response object acknowledges all spans. partialSuccess with
rejectedSpans>0 records accepted/rejected counts and rejects with a partial error;
the entire request is not replayed. A zero-rejection warning succeeds and increments
warning/partial counters, without retaining its text. Unknown JSON fields are ignored.
The warnings counter records nonempty collector diagnostic messages, including
messages attached to rejected partial responses; their text is always discarded.
Since SpanExporter returns void, Tracer conservatively marks a rejected partial batch
as dropped even when the collector accepted some; exporter.stats carries the finer count.
Metrics apply the same rules to `rejectedDataPoints`, expose
OtlpMetricExportError / acceptedDataPoints / rejectedDataPoints, and never interpret
a point rejection as a span count. The reader conservatively marks a partially
accepted metric collection as failed; later cumulative observations retain source
totals. Repeated collections do not reset the registry.
Logs apply the same rules to rejectedLogRecords, with log-specific errors and
accepted/rejected counters. The buffer conservatively drops a failed partial batch;
it does not requeue logs or infer that timeout means the collector never received them.

The exporter admits one batch and retains no pending queue. Tracer separately bounds
active spans, completed queue and its in-flight batch. Busy/closed/invalid/oversized
calls reject before network admission. Failed admitted batches increment failedBatches;
Tracer reports/drops them without replacing the business result or original error.
The metric reader owns point batching and completion-relative collection without
a queue of old snapshots. Each batch has its own delivery deadline. Direct metric
export callers retain the same busy/closed admission boundary.

A custom Fetch must honor AbortSignal. If it does not settle after a deadline, its
pending transport keeps admission busy, preventing repeated orphan requests. A late
response is discarded and never counted as acknowledged. The export Promise still
expires, and close becomes terminal after the admitted deadline; it cannot physically
cancel a transport that ignores cancellation.

close stops new admission, waits for the active batch and memoizes terminal state.
It does not close a global Fetch connection pool. Let Tracer close active spans and
drain its queue first; never close from a span whose end is being awaited.
Metric readers collect once more before closing their exporter. Host/isolate
lifetime remains authoritative. Request retry can duplicate telemetry after a lost
acknowledgement, and a collector acknowledgement does not prove durable downstream
storage. This is bounded best-effort telemetry, not a persistent outbox.

See the protocol's [response/retry rules](https://opentelemetry.io/docs/specs/otlp/#otlphttp-response).
