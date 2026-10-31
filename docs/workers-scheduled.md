# Worker scheduled-event adapter

Owner: `@longhornjs/workers/scheduled`. Connects the platform scheduled handler to
[managed application work](application-work.md), [Workers Fetch](workers.md),
[invocation limits](scheduled-invocations.md) and [tracing](scheduled-telemetry.md).

```ts
import { Longhorn } from '@longhornjs/core'
import { createScheduledWorker } from '@longhornjs/workers/scheduled'

type Bindings = { REPORTS: { write(time: number): Promise<void> } }
const app = new Longhorn<Bindings>()
app.http.get('/health', (c) => c.json({ status: 'ok' }))

export default createScheduledWorker(app, {
  maxConcurrent: 2,
  timeoutMs: 10000,
  handle: async ({ controller, bindings, signal }) => {
    signal.throwIfAborted()
    await bindings.REPORTS.write(controller.scheduledTime)
    signal.throwIfAborted()
  },
})
```

`REPORTS` is an illustrative application binding. The [runnable example](workers-scheduled-example.md)
uses a real local KV namespace. The export contains both `fetch(request, env, ctx)`
and `scheduled(controller, env, ctx)`; both share one application startup.

## Platform objects and completion

`ScheduledInvocation<Bindings>` forwards the original `controller`, `bindings`,
and `context` by identity and adds a cooperative `AbortSignal`. No binding is
copied into shared mutable application state. Controller methods keep their
original receiver when called as `controller.noRetry()`.

Before startup or user work begins, the adapter calls `context.waitUntil` with
the same Promise returned from `scheduled`. That completion includes all awaited
handler work and telemetry. A registration failure prevents startup/user work.
Startup, callback and export-policy errors propagate to platform observation;
the adapter does not convert them to successful HTTP responses.

`scheduledTime` must be a nonnegative safe integer within JavaScript's Date range.
`cron` is an unchanged string of at most 512 characters without control characters;
empty strings are permitted for ad hoc local events. This boundary does not parse
cron grammar or decide when an event is due. It verifies that `noRetry` is callable.

The application decides whether a permanent failure warrants `controller.noRetry()`.
LongHorn never calls it automatically, retries a delivery, or deduplicates events.
Make effects safe for replay; a stable effect key alone does not prevent execution.

## Lifecycle and deployment

`worker.close()` stops scheduled admission, awaits accepted invocations, and shares
one close Promise. It leaves Fetch and the application open. A host can stop
admission with it and then call `app.close()` outside the handlers. Neither close
method is a platform isolate-eviction hook. Do not close a module-scoped app per event.

Platform Cron Triggers and bindings remain deployment configuration. The adapter
creates no cloud resources or polling timer. Workers controls actual delivery,
retry, hard lifetime and termination policy. See [Cloudflare's scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
The local [native gate](workers-scheduled-testing.md) verifies the repository's
declared workerd version without deploying to an account.
