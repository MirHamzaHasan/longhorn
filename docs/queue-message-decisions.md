# Queue message acknowledgement and retry decisions

Owner: `@longhorn/workers/queue`. Connects [queue events](workers-queue-events.md),
application validation/effects, [batch completion](queue-batch-lifecycle.md),
and the platform's own retry/dead-letter policy.

Every handled message must return one valid decision:

```ts
return { action: 'ack' }
return { action: 'retry' }
return { action: 'retry', delaySeconds: 5 }
```

Ack accepts only the action field. Retry accepts action and optional delaySeconds,
an integer 0–86400; zero is explicit rather than omitted. The adapter copies that
primitive option before calling the original message.retry method. Invalid/missing
decisions become QueueDecisionError; they never silently acknowledge a message.
These are adapter bounds, not promises of platform quotas or delivery time.

## Partial failures

Successful returned decisions invoke message.ack/retry with the original receiver.
An explicit retry is a successful policy decision, not a failed handler. A thrown
handler error, invalid decision, or throwing native decision method leaves that
message failed in the adapter. Remaining messages continue through the bounded pool.
No automatic retryAll/ackAll call or local handler retry is installed.

After all started handlers and the optional afterBatch hook settle, message failures
reject the batch with QueueBatchError (an AggregateError). Its errors preserve the
original thrown values in input order, followed by a hook error and budget reason
when present. Startup/registration errors before processing propagate directly.
There is no body/ID interpolation in framework error messages or stats.

Workerd retains explicit per-message acknowledgement/retry flags even when the
batch rejects. Unsettled messages follow platform failure policy. The framework
cannot undo a committed effect or an earlier ack if later work/telemetry fails.
Cloudflare documents first-decision precedence and per-message decisions taking
precedence over batch decisions in [acknowledgement rules](https://developers.cloudflare.com/queues/configuration/batching-retries/).
The [native gate](workers-queue-testing.md) inspects workerd's actual flags separately
from the pinned Miniflare broker's redelivery implementation.

The original batch/message methods remain accessible. Prefer returned decisions
through this adapter: manual ack/retry/ackAll/retryAll calls follow platform rules,
cannot be intercepted/rolled back, and are not represented by adapter call counters.
Do not combine conflicting manual and returned policies and then interpret counters
as authoritative broker delivery totals.

## Application policy and effects

Validate unknown payloads explicitly. The example acknowledges malformed input as
an intentional drop; an application needing quarantine can publish a validated
quarantine record before deciding, or let its configured retry/DLQ policy apply.
Transient storage errors throw and remain unsettled for platform observation.
The adapter makes neither domain decision automatically.

Broker retry limits/delays/dead-letter destinations remain deployment settings.
Attempts come from each original platform message. Use idempotent effects because
a process can stop between effect commit and acknowledgement. The
[receipt example](queue-worker-example.md) preserves the first SQL result by a
business key; it does not claim exactly-once execution or a broker/SQL transaction.
