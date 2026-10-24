# Owned expired-request cleanup

Owner: optional `@longhorn/idempotency/cleanup`. Connects the existing
[request API](idempotency.md), [retention policy](request-cleanup-retention.md),
[lifecycle](idempotency-cleanup-lifecycle.md), [operator host](request-cleanup-host.md)
and [native proof](request-cleanup-testing.md).

```ts
import { IdempotencyCleanup } from '@longhorn/idempotency/cleanup'

// requests is the existing Idempotency instance, with its store and clock.
const cleanup = new IdempotencyCleanup(requests, {
  limit: 100,
  intervalMs: 60_000,
  onError: async () => { logger.warn('Expired request cleanup failed') },
})
app.onStart(() => {
  cleanup.start()
  return () => cleanup.close()
})
// Register the database lifetime before this hook so it closes afterwards.
```

Construction/import creates no work or connection. start() admits the first batch
on a microtask. Each run awaits requests.prune(limit), then waits intervalMs after
settlement, including after a full batch, empty batch or failure. There is no
overlap, backlog spin or catch-up scheduling. One owner may start once; create a
new instance to restart. close() cancels its idle timer and drains admitted work.

Defaults are 100 rows and 60,000 ms. The package accepts integer limits 1–10,000
and intervals 1–2,147,483,647 ms. The operator host uses narrower interval bounds.
The supplied pruner must return an integer count between zero and limit; invalid
results follow the operational-error path. No retention or clock is created here.

snapshot() returns a detached in-memory observation: state (idle, running, closing,
closed), active, runs, removed, errors and observerErrors. active includes the
awaited error observer; runs counts admitted calls and removed counts successful
deletions. These counters reset with the owner and are neither a durable audit nor
a table/backlog size. They expose no keys, scopes, responses or exception text.

The module uses Web timers and no runtime-specific imports. Native Node/Bun/Deno
hosts can own its lifetime. A finite workerd invocation proves the portable
coordination contract; it does not establish a persistent Workers timer service.
For Fetch/scheduled hosts, await bounded requests.prune(limit) calls inside the
platform's existing invocation lifetime. Callback and batch-sqlite APIs retain
their separate contracts.

The scheduling engine is now the shared optional [PruneWorker](prune-worker.md).
The existing IdempotencyCleanup facade, options, snapshots and shutdown/error
behavior remain compatible. [Rate-limit cleanup](rate-limit-cleanup.md) uses the
same owner with its own store/clock/expiry protocol.
