# OTLP delivery and lifetime

Owner: OtlpHttpSpanExporter. Connects [Tracer queue ownership](tracing.md),
[wire encoding](otlp-json.md), [configuration](otlp-configuration.md) and
[native failure tests](otlp-native.md).

| Option | Default | Allowed |
| --- | --- | --- |
| timeoutMs | 10000 | 1–60000 ms |
| maxAttempts | 3 | 1–5, including initial request |
| initialRetryDelayMs | 200 | 1–60000 ms |
| maxRetryDelayMs | 2000 | initial delay–60000 ms |
| maxSpansPerBatch | 256 | 1–10000 |
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

The exporter admits one batch and retains no pending queue. Tracer separately bounds
active spans, completed queue and its in-flight batch. Busy/closed/invalid/oversized
calls reject before network admission. Failed admitted batches increment failedBatches;
Tracer reports/drops them without replacing the business result or original error.

A custom Fetch must honor AbortSignal. If it does not settle after a deadline, its
pending transport keeps admission busy, preventing repeated orphan requests. A late
response is discarded and never counted as acknowledged. The export Promise still
expires, and close becomes terminal after the admitted deadline; it cannot physically
cancel a transport that ignores cancellation.

close stops new admission, waits for the active batch and memoizes terminal state.
It does not close a global Fetch connection pool. Let Tracer close active spans and
drain its queue first; never close from a span whose end is being awaited. Host/isolate
lifetime remains authoritative. Request retry can duplicate telemetry after a lost
acknowledgement, and a collector acknowledgement does not prove durable downstream
storage. This is bounded best-effort telemetry, not a persistent outbox.

See the protocol's [response/retry rules](https://opentelemetry.io/docs/specs/otlp/#otlphttp-response).
