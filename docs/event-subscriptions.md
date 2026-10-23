# Event subscriptions and lifecycle ownership

Owner: `EventBus.on`, `once`, and `scope` from `@longhorn/events`. Connects typed
[event delivery](events.md) to explicit feature and application lifetimes.

```ts
const scope = events.scope()
const off = scope.on(TaskCreated, async (task, context) => {
  await updateView(task, context.signal)
})
scope.once(ApplicationReady, () => { markReady() })

off()                // Idempotent; only removes this registration.
await scope.close()  // Removes the remaining registrations and drains their work.
```

`updateView`/`markReady` are application functions; event definitions are shared
module imports. Duplicate callback registrations remain independent. There is no
ambiguous global `off(name, callback)` operation.

## Subscription lifetime

An unsubscribe removes routing immediately. Callbacks not yet started in an accepted
dispatch are skipped; callbacks already executing continue. The same rule applies
to an aborted registration signal. This is removal, not forced promise cancellation.
Pass an AbortSignal to `on` or `once` and use `context.signal` for cooperative
cancellation inside a handler when appropriate. An already-aborted signal creates
no subscription. The bus releases its signal binding on removal or once completion.

Once delivery is reserved before any listener executes. Concurrent/recursive emits
cannot reserve it twice. If it is removed or its scope closes before that reserved
turn starts, the delivery is skipped and the once registration stays consumed.

Closing a scope synchronously stops new subscriptions in it and removes its existing
ones, including reserved once-listeners. It then waits for callbacks already running
in that scope. Other scopes and the bus remain usable. Repeated close calls return
the same promise; state transitions are `open -> closing -> closed`.

## Application cleanup order

Register the event resource after resources that its subscribers need, because
LongHorn cleans startup resources in reverse order:

```ts
app.onStart(async () => {
  const database = await openDatabase()
  registerDatabaseProvider(database)
  return () => database.close()
})
app.onStart(() => {
  const scope = events.scope()
  scope.on(TaskCreated, recordActivity)
  return () => events.close()
})
```

This sketch uses application functions for resource registration. The
[tasks example](task-events.md) supplies the full implementation. Startup acquires
SQLite before event ownership; shutdown drains HTTP, then the event bus, then closes
SQLite. A later startup failure rolls back both resources in that reverse order.
An application-wide bus may own many feature scopes; close a scope to unload one
feature, and close the bus when its application lifetime ends.

Bus close differs from scope close: it first refuses new root work, allows all
accepted listeners and context-owned follow-ups to complete, then removes routing
and closes scopes. Explicit subscriber disposal can still skip a not-yet-started
callback. Dispatch errors stay with `emit`; successful cleanup does not turn failed
delivery into success.

Call drain operations from the host or lifecycle cleanup, outside the listeners
whose completion they wait for. Awaiting the bus or its own scope's close from
inside such a listener waits on that listener and deadlocks. Self-removal should
use its unsubscribe function or `once`. Likewise, return/await all listener work;
detached asynchronous work is not automatically owned after a callback returns.
No timeout or forced cancellation is imposed on a non-settling handler.

## Verification

Unit tests cover removal during delivery, concurrent once reservation, signal
cleanup, scope draining, independent lifetimes, accepted child work during close,
repeated close, and delivery errors during shutdown. The real SQLite integration
blocks an event callback, starts application close, then proves its follow-up can
still query the database before the connection is closed. Startup rollback is
verified separately. `pnpm test:events` checks the contract on every runtime target.
