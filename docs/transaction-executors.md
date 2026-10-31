# Managed transaction executor ownership

Owner: `@longhornjs/database/transactions`. Connects the portable [Database](database.md)
contract to [transaction publishing](transaction-publishing.md) and native provider
commit/rollback. It imports no native driver or platform API.

Built-in Node SQLite, Node PostgreSQL and Durable Object SQLite transaction callbacks
now receive an immutable executor with private runtime provenance. The existing
SqlExecutor callback type stays compatible. `isTransactionExecutor(tx)` narrows to
TransactionExecutor; `assertTransactionExecutor(tx, database?)` verifies active
provenance and optionally the exact owner. Copying/spreading an executor does not
copy its capability. The Database root is not a transaction executor.

## Accepted transaction work

`participateInTransaction(tx, work)` registers work synchronously while the callback
scope is open. It supplies a private checked executor to that participant. Transaction
publishing uses this to own schema preparation and SQL insertion through completion.

When the callback returns, its public executor expires. The provider seals admission
and drains accepted participants before commit; their private executors remain usable
only while their own work is active. A failed participant prevents completion even
if its caller caught the error. If several fail, the first by registration order is
retained, including arbitrary/undefined rejection values. Retained descendant
executors expire when their operation settles.

If business work throws, abort stops later participant writes and waits for actual
accepted work before rollback. It does not abandon an async validator or an already
running query. Original business errors remain with the caller; native rollback
failures retain the provider's existing aggregate policy. Keep transaction work
short and await descendants. This is not cancellation of arbitrary JavaScript.

## Provider integration

Custom database providers can opt in explicitly:

```ts
const scope = createTransactionScope(database, nativeTransactionExecutor)
try {
  const result = await callback(scope.executor)
  await scope.complete()
  await commitNativeTransaction()
  return result
} catch (error) {
  await scope.abort()
  await rollbackNativeTransaction()
  throw error
}
```

The surrounding provider owns connection leasing, native BEGIN/COMMIT/ROLLBACK,
query drain, rollback aggregation and reentrancy. The scope factory controls none
of those operations. Register the original Database handle returned to applications;
forwarding wrappers do not automatically inherit its identity. Existing custom
providers remain usable through Database, but transaction publishing rejects their
unregistered executors until they adopt this lifecycle.

The built-in Object provider drains participants before its optional alarm commit
hook, so every accepted job is present when wakeups are projected. Node providers
drain before native commit. [Scope tests](../packages/database/src/transactions.test.ts)
cover ownership, expiry, synchronous admission, sealed scopes, ordered failures and
abort drain. [Native proofs](transaction-publishing-testing.md) verify the database
integration rather than inferring atomicity from scope tags alone.
