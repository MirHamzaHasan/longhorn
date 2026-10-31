# Worker queue-event adapter

Owner: `@longhornjs/workers/queue`. Connects platform broker batches to
[managed application work](application-work.md), [Fetch](workers.md),
[message decisions](queue-message-decisions.md), [batch lifetime](queue-batch-lifecycle.md)
and [consumer tracing](queue-consumer-telemetry.md).

```ts
import { Longhorn } from '@longhornjs/core'
import { createQueueWorker } from '@longhornjs/workers/queue'

const app = new Longhorn<Bindings>()
export default createQueueWorker(app, {
  messageConcurrency: 4,
  handle: async ({ message, bindings, signal }) => {
    signal.throwIfAborted()
    await saveValidatedMessage(message.body, bindings)
    return { action: 'ack' }
  },
})
```

`Bindings` and `saveValidatedMessage` are application services above. Body defaults
to unknown: the adapter validates transport metadata, not application payloads.
Use [safeParse](validation.md) with a Standard Schema before producing effects.
The [runnable example](queue-worker-example.md) uses Zod and Object SQL receipts.

## Platform boundary

The export contains `fetch(request, env, ctx)` and `queue(batch, env, ctx)`.
Each invocation forwards the original batch, message objects, bindings and context.
The adapter snapshots array membership at admission, preserving message references;
later changes to the source array cannot add unbounded work to that invocation.
Methods remain on their original objects. The callback receives those objects plus
a cooperative AbortSignal. There is no implicit HTTP request or async trace context.

The exact returned completion Promise is registered with context.waitUntil before
startup/user code runs. Fetch and queue dispatch share app startup. A registration
failure prevents startup and callback entry. The application stays open between
events. `worker.close()` stops queue admission and drains accepted batches; it does
not close Fetch or the application. Platform bindings/deployment remain host-owned.

`WorkerQueueMessage` and `WorkerQueueBatch` use the existing platform fields rather
than requiring newer optional metrics metadata. Queue names are nonempty strings
up to 256 characters without control characters. Message IDs are unique within the
batch, nonempty, up to 512 characters without controls; timestamps must be valid
nonnegative Dates and attempts positive safe integers. Ack/retry methods must be
callable. The complete batch is checked before any message enters user work.
Empty ad hoc batches are accepted; an oversized/malformed batch rejects intact.

This adapter implements the broker event lifetime. It does not enqueue into
`@longhornjs/queue`, assign SQL leases, increment broker attempts, run a retry timer,
or configure a dead-letter queue. See [Cloudflare's queue API](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
for platform configuration and [native verification](workers-queue-testing.md)
for the pinned local engine's tested behavior and broker limitations.
