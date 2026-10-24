# Buffered asynchronous log delivery

Owner: `BufferedLogProcessor`, `LogExporter`, `LogEntry` and `LogProcessorError`
from `@longhorn/observability`. Connects the existing synchronous
[logger sink](logger-sinks.md) to an exclusively owned async exporter. The root
imports no HTTP/native transport. [OTLP logs](otlp-logs.md) is one provider.

```ts
const processor = new BufferedLogProcessor({
  exporter, maxBufferedRecords: 1024, maxBufferedBytes: 1048576,
  onError: error => localLogger.warn('Log delivery failed', { operation: error.operation }),
})
const logger = createLogger({ sink: processor.sink })
logger.info('Accepted work') // synchronous; never awaits the collector
await processor.flush()     // best-effort counters, including failed batches
await processor.close()     // stop admission, drain accepted work, close exporter
```

`sink` is a bound LogSink. `emit(record, context?)` additionally captures an explicit
SpanContext; correlation is never inferred from arbitrary fields by the library.
An injected `now` supplies observed epoch milliseconds, default Date.now. Accepted
entries snapshot the normalized logger record, observed time and optional context
before returning. Caller mutation cannot change queued data. Logger serialization
has already run; this processor does not change that earlier normalization policy.

There is no timer. A microtask sends count/byte-bounded batches serially. Capacity
includes queued and in-flight entries. Overflow drops the newest candidate without
blocking or throwing to application work; accepted earlier records keep their order.
Invalid/oversized entries also drop before export, with sanitized record failure.
The total byte counter measures normalized entry JSON, not exact heap/RSS usage.
Object/node/depth limits and record count bound retained structure separately.

| Option | Default | Allowed |
| --- | --- | --- |
| maxBufferedRecords | 1024 | 1–100000, including active batch |
| maxBufferedBytes | 1048576 | 1–67108864 normalized JSON bytes |
| maxRecordBytes | 16384 | 1–1048576; must fit buffer and batch |
| maxBatchRecords | 64 | 1–10000 |
| maxBatchBytes | 32768 | 1–16777216 normalized JSON bytes |

The exporter independently limits its encoded wire request. Choose compatible
count/byte budgets; the processor cannot infer an arbitrary provider's encoding
overhead. A failed/partially accepted batch is conservatively dropped here; the
exporter exposes finer acknowledged counts. No disk spool, replay-after-restart,
automatic requeue or durable delivery guarantee is added.

Flush drains accepted work and returns stats. Close rejects new records by counting
closed drops, drains and closes the exporter once; repeated calls share its promise.
Export failures remain best effort and do not reject close. Exporter close failure
rejects with a fixed LogProcessorError('close'), and state still becomes closed.
Custom exporters must settle for cooperative drain; the [OTLP transport](otlp-delivery.md)
supplies per-batch deadlines. Do not await processor flush/close from the exporter
operation they are waiting for. Stop producers before final close.

Stats include queued/in-flight/bytes, accepted/exported/dropped, invalid records,
capacity/closed/feedback drops, failed batches and closing/closed state. Errors
contain record/export/close operations without source record, endpoint or raw cause.
The synchronous onError observer is isolated. Direct feedback into the same sink
during that observer is counted/dropped to prevent recursive network logging;
using a separate local logger remains the intended error path.
