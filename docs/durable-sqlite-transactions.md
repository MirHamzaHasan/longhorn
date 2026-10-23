# Durable SQLite transactions and resource ownership

Owner: `@longhorn/workers/durable-sqlite`. Connects the [provider](workers-durable-sqlite.md)
to core [lifecycle](lifecycle.md), the [queue ownership protocol](workers-durable-queues.md)
and [atomic schedule dispatch](workers-durable-scheduler.md).

```ts
const result = await database.transaction(async (tx) => {
  const row = (await tx.execute('SELECT value FROM counters WHERE id = 1')).rows[0]
  await tx.execute({ sql: 'UPDATE counters SET value = ? WHERE id = 1', args: [Number(row!.value)+1] })
  return 'updated'
})
```

Use the callback executor, await every operation, and return/await all descendants.
The provider commits on success and preserves callback values; a thrown original
error rolls back the callback and remains the caller's rejection. The executor
expires when the callback settles, including failure. It cannot open nested
transactions or outlive its scope. Raw SQL cursors never leave the provider.

## Admission and platform input gate

Handles over the same storage object share a serial gate. `maxPending` defaults
to 64, accepts integers 1–1024, and bounds admitted root calls including the active
operation. The caller's configured bound is checked against that shared count;
one callback transaction is one root call. Capacity errors contain no SQL/bindings.
Transaction executor calls are synchronous native SQL wrapped as promises and do
not consume separate root slots.

Each root operation runs in `storage.transaction` inside the original state's
`blockConcurrencyWhile`. This keeps other Object events outside an unfinished
transaction. Queries, migrations and all stores using that storage must go through
this provider; raw `state.storage.sql` access can bypass its ownership discipline.
Accepted root calls queue serially before execution. A root call made while an
operation is already active rejects, including through a second handle. This
prevents callback reentrancy deadlocks without Node async-context APIs. It also
means same-event timer/continuation code must use its transaction executor or wait
until the active operation finishes. Separate Object client events are held by the
platform input gate, as verified with competing native HTTP clients.

Errors are captured *inside* the input-gate callback and rethrown after it returns.
An ordinary SQL/domain rejection therefore does not escape blockConcurrencyWhile
and reset the Object. Platform termination, state.abort, storage failure and the
platform input-gate deadline remain native policy. Keep callbacks short and limited
to SQL work. External I/O/side effects inside a transaction can hold the Object's
input gate, cannot be rolled back, and must not assume callbacks are never replayed.
See [Cloudflare's input-gate contract](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)
for native reset/deadline behavior.

## Close and lifecycle

Close stops new root admission immediately, memoizes one Promise, waits for the
already accepted shared gate, then calls storage.sync. It also drains a callback
that is currently awaiting work. Never await close from inside that callback: close
waits for the callback itself. Initiate shutdown from the owning host/app after
managed work drains. No native SQLite connection is destroyed, no table is deleted,
and another open handle can continue using the binding.

The [example](workers-durable-example.md) acquires the database before queue and
scheduler resources. Core drains requests first, then cleanup closes scheduler,
queue and database in reverse order. The platform owns Object eviction and may
restart it without general-purpose application cleanup; persisted rows, not JS
instances, carry the durable state. See [native tests](workers-durable-testing.md)
for expiry/reentrancy, active-work close and actual Object-abort recovery.
