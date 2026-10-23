# Durable outgoing recovery audit

Owner: Outbox.retryFailedAudited and optional OutboxAuditStore. Connects
[deliberate retry](outbox-deliberate-retry.md), [storage](outbox-audit-storage.md),
[attribution](outbox-audit-attribution.md), [atomicity](outbox-audit-atomicity.md)
and [HTTP operations](outbox-audit-http.md).

```ts
const action = await outgoing.retryFailedAudited(delivery.id, {
  expectedMaxAttempts: delivery.maxAttempts,
  additionalAttempts: 2,
  actor: `user:${authenticatedUser.id}`,
  reason: 'provider-restored',
})
// action.result is the existing RetryFailedResult.
// action.audit is the committed record of this action and result.
```

The native transaction performs the same conditional failed-to-pending transition
and appends its audit record before committing. A failed append rolls back the
transition. Object SQL also commits its alarm projection with that state/history.
The ID/payload, cumulative attempts, observed ceiling and 100-attempt cap keep the
existing retry semantics. No broker call runs inside this transaction.

Every valid call creates a new server-generated audit UUID, including conflict,
budget-exhausted and missing results. Malformed input is rejected before storage;
operational/database failure leaves neither a committed result record nor a partial
transition. Repeating an action after a lost reply may record a new conflict, but
the old observed ceiling cannot grant the same budget again. Audit IDs identify
calls; they are not client idempotency keys.

A RecoveryAudit contains id, queue, deliveryId, actor, reason, createdAt, observed
expectedMaxAttempts, requested additionalAttempts/availableAt, outcome and a bounded
result summary (state/attempts/maxAttempts/lastFailure, or null for missing). It
does not copy payloads, lease tokens, credentials or arbitrary exception text. Actor
and reason are trusted application-supplied identifiers, not unrestricted data bags.

Audit is opt-in. Existing retryFailed stays available without audit storage for
applications that choose it; direct SQL/that API are outside this trail's coverage.
The Worker operations route now selects the audited API. Stores create no timer
or connection; all audit methods join Outbox admission/close ownership. Older
custom stores can retain ordinary functionality and optionally implement the audit
capability. Missing capability/schema is an error, never an unaudited fallback.

See [history](outbox-audit-history.md), [retention](outbox-audit-retention.md),
[native proof](outbox-audit-testing.md) and the [example](outbox-worker-example.md).
