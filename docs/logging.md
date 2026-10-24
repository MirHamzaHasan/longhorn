# Structured and request logging

Owner: `@longhorn/logger`. The root entrypoint imports no HTTP or Node APIs.
`@longhorn/logger/hono` supplies request middleware. Core connects both to the
[HTTP application](http.md) and the example connects them to [lifecycle](lifecycle.md).

## Logger API

```ts
import { createLogger } from '@longhorn/logger'

const logger = createLogger({ level: 'info', bindings: { app: 'LongHorn' } })
logger.info('Worker ready', { queue: 'mail' })
logger.child({ jobId: '123' }).warn('Retrying', { attempt: 2 })
logger.error('Connection failed', { error: new Error('Offline') })
```

Methods are `debug`, `info`, `warn`, `error`, and `child`. Levels below the configured
threshold are ignored; `silent` ignores everything. A standalone logger defaults
to `info`. `new Longhorn()` defaults to a silent logger. Pass an explicit logger to
enable application logging:

```ts
const app = new Longhorn({ logger })
```

Every emitted record has `timestamp`, `level`, `message`, and nested `fields`.
Application fields cannot replace the record's reserved metadata. Child bindings
overlay parent bindings; per-call fields overlay child bindings. The default sink
writes one JSON record per line, using `console.error` for errors, `console.warn`
for warnings, and `console.log` for info/debug.

Options include `level`, `bindings`, `sink`, `redact`, and `clock`. A custom sink
receives a structured record synchronously. A custom clock returns a `Date`. Sinks
are best-effort: exceptions do not interrupt request handling or resource cleanup.
The logger itself remains synchronous. [Sink fanout](logger-sinks.md) composes local
destinations, while the optional [buffered processor](log-processing.md) supplies
owned asynchronous delivery, flush and final drain without changing logger methods.

## Field serialization

Errors retain their name, message, stack, cause, and aggregate errors. Bigints and
symbols become strings. Cycles and excessive depth become markers rather than
throwing. Unserializable objects become `[Unserializable]`. Input objects are not
changed.

By default, matching field keys are redacted recursively, case-insensitively:
`password`, `token`, `secret`, `authorization`, `cookie`, and `apiKey`.
`redact` replaces this list, so include the defaults when adding custom keys.
Messages, stack traces, URL path segments, and values under other keys are supplied
by application code and are not scanned for sensitive text.
The [remote reports profile](jobs-logs-export.md) explicitly projects metadata before
export. No remote destination is automatically selected by the logger package.

## Request logging

Core installs request middleware automatically. Each request receives a new
server-generated `X-Request-Id` response header. Incoming IDs are not trusted or
reused. Handlers receive:

```ts
app.http.get('/hello', (c) => {
  c.get('logger').info('Handling hello')
  return c.json({ requestId: c.get('requestId') })
})
```

The child logger includes `requestId`, method, and URL path. Completion records add
fields from the current request child logger, so application middleware can attach
traceId/spanId through child(...); [HTTP telemetry](http-telemetry.md) shows that wiring.
Core does not depend on a tracing provider. Completion records also add
status and duration in milliseconds. Statuses below 400 use `info`, 4xx uses `warn`,
and 5xx uses `error`. Request bodies, headers, and query strings are not added.

Unexpected HTTP errors get a separate correlated error record, followed by the
completion record. The response remains a generic JSON 500. Explicit HTTP errors
retain their intended response and are represented in the completion record.
Applications replacing `app.http.onError()` own their error diagnostics.

For a standalone Hono application, use `requestLogger(logger)` from
`@longhorn/logger/hono`. The middleware follows [Hono's execution model](https://hono.dev/docs/guides/middleware).
It reports handler completion; it does not measure the full transmission time of a
streaming response.

The example validates `LOG_LEVEL` through its configuration schema and creates a
logger with the configured application name. Startup, listening address, request
completion, and shutdown are structured records.

## Verification

[Logger tests](../packages/logger/src/logger.test.ts) cover filtering, child context,
redaction, serialization, console routing, and sink failure isolation.
[Core logging tests](../packages/core/src/logging.test.ts) verify request IDs,
correlated errors, status levels, and omission of request bodies/headers/query values.
