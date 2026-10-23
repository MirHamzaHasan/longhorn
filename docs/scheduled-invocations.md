# Scheduled invocation admission and budgets

Owner: `@longhorn/workers/scheduled`. Connects [platform events](workers-scheduled.md)
to [core resource ownership](application-work.md) and [awaited telemetry](scheduled-telemetry.md).

| Option | Default | Accepted values | Meaning |
| --- | --- | --- | --- |
| `maxConcurrent` | 1 | Integer 1–64 | Active accepted scheduled invocations in this adapter instance |
| `timeoutMs` | 30000 | Integer 1–900000 | Cooperative budget starting at admission |

Construction validates and snapshots these values and the callback. These bounds
are LongHorn settings, not platform quota promises. Instances/isolates do not share
capacity. An event waiting for shared startup already occupies a slot and budget.
Fetch traffic does not consume scheduled slots.

Busy calls reject with `ScheduledCapacityError`; closing/closed calls reject with
`ScheduledClosedError`; invalid metadata rejects with `ScheduledInputError`.
Each admission rejection is also registered with `waitUntil`. Constant error
messages omit bindings, event metadata and user errors. When `waitUntil` itself
throws, its registration error is propagated.

## Cooperative cancellation

The timer aborts the invocation signal with `ScheduledTimeoutError`. Check the
signal around non-cancellable work and pass it to APIs that support cancellation:

```ts
handle: async ({ signal }) => {
  signal.throwIfAborted()
  await fetch(destination, { signal })
  signal.throwIfAborted()
}
```

`destination` is application configuration. Aborting does not forcibly interrupt
JavaScript or undo committed effects. The adapter keeps the actual callback,
`waitUntil` completion, capacity slot and application resources alive until all
awaited work settles. An ignored signal therefore keeps close pending. There is
no timeout race that silently leaves abandoned resource users behind.

The adapter checks abort before entering the handler and after it returns. Work
that returns after expiry becomes a timeout failure; a callback's own rejection
is preserved, including when the signal has aborted. Awaited trace flush is part
of the same budget. No internal retry or noRetry decision follows a timeout.

## Diagnostics and verification

`stats()` returns a fresh snapshot: `active`, `succeeded`, `failed`, `rejected`,
`timedOut`, `closing`, `closed`. Counts are instance-local. `rejected` counts
admission failures; `failed` counts failed admitted work. `timedOut` overlaps
failures rather than forming a separate outcome category. Raw controllers,
bindings, cron strings and callback errors are not stored in these stats.

[Adapter tests](../runtimes/workers/src/scheduled.test.ts) exercise startup budgets,
cooperative and ignored aborts, capacity release, metadata/options, original errors,
registration failure, and flush ownership. The [native gate](workers-scheduled-testing.md)
checks those lifetime decisions with actual workerd events and controlled I/O.
