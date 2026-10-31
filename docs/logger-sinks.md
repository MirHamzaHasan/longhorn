# Local log sinks and fanout

Owner: `consoleLogSink` and `fanoutLogSinks` from `@longhornjs/logger`. Connects
[structured logging](logging.md) to explicitly selected synchronous destinations,
including a [buffered asynchronous bridge](log-processing.md).

```ts
import { createLogger, consoleLogSink, fanoutLogSinks } from '@longhornjs/logger'

const logger = createLogger({ sink: fanoutLogSinks([consoleLogSink, processor.sink]) })
logger.info('Worker ready', { component: 'worker' })
await processor.close()
```

`consoleLogSink` is the existing JSON console behavior exposed for composition:
error uses console.error, warn uses console.warn, other levels use console.log.
It does not run filtering, clock selection or redaction again; createLogger already
produced that normalized record. Default logger behavior is unchanged.

Fanout snapshots a list of 1–16 sink functions, calls them in order and isolates
each synchronous exception, so a failed destination does not skip later sinks.
All sinks borrow the same readonly normalized record and must not mutate it.
The helper creates no queue, timer or transport. A raw asynchronous sink has no
flush/lifetime contract here; use BufferedLogProcessor.sink for owned async work.

Logger normalization/redaction happens before fanout. Fields with standard sensitive
keys remain redacted, while arbitrary messages, stack text and other values remain
application-owned. Each destination chooses its own projection/retention policy.
The [reports host](jobs-logs-export.md) preserves full local output and explicitly
projects remote metadata. Tests prove ordering, stable records, redaction and
continued delivery after one sink throws.
