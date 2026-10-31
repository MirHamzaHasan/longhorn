# Queue batch admission, budgets and resource drain

Owner: `@longhornjs/workers/queue`. Connects [queue events](workers-queue-events.md),
[core app.run](application-work.md), [message decisions](queue-message-decisions.md)
and [awaited telemetry](queue-consumer-telemetry.md).

| Option | Default | Accepted values | Ownership |
| --- | --- | --- | --- |
| maxConcurrentBatches | 1 | Integer 1–64 | Accepted queue events per adapter instance |
| messageConcurrency | 4 | Integer 1–64 | Started message callbacks per batch |
| maxBatchSize | 100 | Integer 1–100 | Admission bound for one batch |
| timeoutMs | 30000 | Integer 1–900000 | Cooperative budget from admission |

Options and callbacks are snapshotted during construction. These settings do not
share state across isolates and do not configure the platform consumer. Fetch uses
its own lifetime and does not occupy a queue slot. Startup waiting already counts
as an admitted batch and consumes its budget. The handler pool stops taking new
messages when its event signal aborts, while other completed policy decisions remain.

Capacity/closing/input errors are QueueCapacityError, QueueClosedError and
QueueBatchInputError. Admission failures are returned and registered with waitUntil;
no partial processing begins. If lifetime registration throws, that original error
is propagated without executing startup/user work.

## Cooperative budget

The timer aborts the shared event signal with QueueTimeoutError. Pass it to
cancellable APIs and check it around non-cancellable work. The adapter checks it
before message decisions, so a handler returning success after expiry is not
automatically acknowledged. Unstarted messages remain unsettled. Cancellation does
not undo already-applied native decisions or committed effects.

The real callback/afterBatch promises retain the platform completion, capacity slot
and application resources until settlement. An ignored abort therefore keeps close
pending. No timeout race abandons live resource users. The budget includes startup,
validation/processing, decisions and awaited telemetry; platform hard termination
and CPU/lifetime policy remain independent.

## Close and diagnostics

Adapter close is memoized, stops later queue admission and drains every accepted
batch. It leaves Fetch/app open. Core close drains app.run callbacks before releasing
resources. Initiate these operations outside the callbacks/hooks they await; calling
close from owned work can wait for itself. Detached descendants or separate platform
waitUntil registrations are not automatically discovered by core's managed callback.

`stats()` returns fresh instance-local counters: activeBatches/activeMessages,
succeededBatches/failedBatches/rejectedBatches, acked/retried/failedMessages,
skippedMessages, timedOut, closing/closed. Message counts describe adapter decisions
and failures, not durable broker totals. Skipped counts cover messages left unstarted
when an entered processing pool stops; admission/startup failures never enter that
pool. timedOut overlaps failed batches. Stats retain no IDs, queue names, bodies,
bindings or errors. afterBatch gets a separate per-batch summary captured after
message processing and before that hook, without IDs or failure objects.

[Unit tests](../runtimes/workers/src/queue.test.ts) cover registration/startup races,
ordered failures, input/options, per-batch pools, ignored/cooperative abort and close.
[Native proofs](workers-queue-testing.md) hold actual workerd handlers/export open
while checking capacity and concurrent core/adapter shutdown ownership.
