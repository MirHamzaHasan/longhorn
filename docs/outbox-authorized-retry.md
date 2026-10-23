# Transaction-authorized outgoing retry

Owner: `Outbox.retryFailedAuthorized` and optional `OutboxAuthorizedStore` in
`@longhorn/outbox`. Connects [conditional retry](outbox-deliberate-retry.md),
[audit atomicity](outbox-audit-atomicity.md), [transaction authentication](transaction-authentication.md)
and [shared HTTP operations](outbox-hono.md).

```ts
await outgoing.retryFailedAuthorized(id, {
  expectedMaxAttempts: observed.maxAttempts,
  additionalAttempts: 1,
  reason: 'provider-restored',
}, async tx => {
  const principal = await accounts.authenticateInTransaction(tx, token)
  if (!principal?.user.roles.includes('numbers-operator')) throw new Error('Forbidden')
  return { actor: 'user:' + principal.user.id }
})
```

The callback receives the Outbox store's managed SQL executor before any recovery
or audit write. It must enforce application role/resource policy and return a
trusted actor. Throwing aborts without a transition or audit. Successful policy,
conditional retry, result audit and any Object alarm projection share one commit.
Both built-in SQL stores implement this capability through the existing audit
transaction. An unsupported store throws; the library never silently weakens policy.

Input/actor validation, stable message IDs, cumulative attempts and the ceiling
of 100 remain unchanged. Valid conflict/missing results still append an audit
after authorization. The request clock determines audit time and delayed
availability before database waits; those timestamps are not commit timestamps.
Close rejects new actions and drains accepted callbacks before store release.

The auth and Outbox stores must borrow the same Database object. Matching URLs
on different pools do not satisfy transaction provenance. Await the callback's
work; do not perform external delivery inside it. The original retryFailedAudited
API remains available for applications with a trusted service principal and
their own admission policy. [Native tests](operator-accounts-testing.md) prove
denial, attribution, concurrency, process interruption and Object rollback.
