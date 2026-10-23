# Deliberate retry with the original message identity

Owner: Outbox.retryFailed and OutboxRecoveryStore. Connects
[inspection](outbox-inspection.md), [conditional concurrency](outbox-recovery-concurrency.md),
[queue attempts](queues.md), [consumer deduplication](outbox-consumer-deduplication.md)
and [HTTP operations](outbox-operations-http.md).

```ts
const result = await outgoing.retryFailed(delivery.id, {
  expectedMaxAttempts: delivery.maxAttempts,
  additionalAttempts: 2,
  delayMs: 0,
})
```

Only a failed record can return to pending. The caller supplies its observed
maxAttempts as a compare-and-set revision. The successful native UPDATE requires
that exact queue/ID/state/ceiling and raises the ceiling by additionalAttempts.
The ceiling strictly increases, so an old request cannot match a later failure
even at an identical clock timestamp. No separate mutable revision table or
timestamp-based lock is introduced.

| Result status | Meaning |
| --- | --- |
| scheduled | This operation committed failed -> pending; delivery is its resulting snapshot |
| conflict | Record changed, expected ceiling is stale, or state is not failed; current metadata included |
| budget-exhausted | Matching failed record cannot extend its ceiling beyond 100; unchanged metadata included |
| missing | No record in this Outbox, including after pruning; nothing recreated |

additionalAttempts defaults to 3 and accepts 1–100, with the resulting lifetime
ceiling capped at 100. attempts is never reset: publisher context attempt remains
cumulative. The grant extends the old ceiling, so any previously unused budget
also remains available (for example after an invalid-payload terminal failure).
A record already at ceiling 100 cannot be deliberately retried through this API,
even if it failed early. Existing cumulative-attempt backoff rules still apply to
subsequent automatic retries.

The ID, topic, payload and original creation time stay unchanged. The operation
clears lease ownership, retains the last known failure category, updates status
time and sets availableAt from the service clock plus delayMs. Delay must be a
nonnegative safe integer whose resulting timestamp is safe; the HTTP example caps
it at one day. It describes eligibility relative to the service operation's clock,
not a guarantee of immediate execution or an interval after a delayed SQL commit.

Revalidation still happens on dispatch. Retrying an invalid payload does not edit
or repair it. A publisher may already have accepted a message whose record became
failed; retaining the ID lets consumers dedupe the new delivery. Never replace
this operation with enqueue to recover an ambiguous acceptance: enqueue assigns a
new application ID. succeeded/pending/running records are not eligible for retry.

No broker call occurs inside retryFailed. A dispatcher/alarm later claims the
pending row. On Object SQL its existing commit hook projects the wakeup with that
status transition. A lost HTTP reply can be resolved by reinspection: repeating
the old request conflicts rather than granting another budget. This API does not
record an operator identity/reason or audit history. The separate
[retryFailedAudited API](outbox-audit.md) now composes that record with the transition,
and the example operations route uses it. Authorization belongs to the calling
application; see [the opt-in guard](outbox-operations-authorization.md).
