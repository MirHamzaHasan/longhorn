# Typed application events

Owner: `@longhornjs/events`. A dependency-free, runtime-neutral event bus for application
features. Connect it through [DI](dependency-injection.md) and own its shutdown through
[lifecycle](lifecycle.md). Core does not create a hidden global bus.

```ts
import { defineEvent, EventBus, EventDispatchError } from '@longhornjs/events'

const TaskCreated = defineEvent<{ readonly id: string }>('task.created')
const events = new EventBus()
const off = events.on(TaskCreated, async (task, context) => {
  await observeTask(task.id, context.correlationId)
})

try {
  const result = await events.emit(TaskCreated, { id: '123' }, { correlationId: 'request-id' })
  console.log(result.eventId, result.listenerCount)
} catch (error) {
  if (error instanceof EventDispatchError) handleObserverErrors(error.errors)
  else throw error
}
off()
await events.close()
```

`observeTask` and `handleObserverErrors` above are application functions. For a complete
working integration, see [task events](task-events.md), [subscriptions](event-subscriptions.md),
and the [portable example](portable-example.md).

## Identity and typing

`defineEvent<T>(name)` creates a frozen descriptor with a unique symbol identity and
a trimmed nonempty name. Two definitions with the same name remain different events;
import the same definition across producers and consumers. The name is for diagnostics,
not routing, serialization, or cross-process discovery.

Payload types are invariant. `emit` infers the type from the descriptor, not from a
contradictory payload argument. Listener payloads and `context.emit` retain that type.
Use `defineEvent<void>(...)` and explicitly pass `undefined` for a signal without
payload data. These contracts use TypeScript's `NoInfer`; the repository/starters
use a compatible TypeScript version.

Payloads are passed by reference, without runtime schema validation, cloning, or
deep freezing. Define immutable domain values and validate external input before
publishing. The tasks example freezes its event envelope and task snapshots. The
bus does not log or persist payloads.

## Dispatch and failure behavior

`emit(type, payload, { correlationId? })` admits the dispatch and snapshots current
subscriptions synchronously, then starts delivery in a microtask. Listeners run in
registration order within that emission, and each returned promise is awaited.
Independent emissions may overlap; the bus does not globally serialize them.

New subscriptions do not join an existing snapshot. Removing/aborting a subscription
before its turn skips that invocation. Once-listeners are reserved at admission,
so concurrent or recursive dispatches cannot reserve the same once subscription
again. Details are in [subscription ownership](event-subscriptions.md).

Every eligible listener is attempted even if an earlier listener throws/rejects.
After delivery, failures reject `emit` with `EventDispatchError`, an `AggregateError`
containing `eventId`, `eventName`, and the original thrown values in order. Successful
delivery returns `{ eventId, name, listenerCount }`, counting actual invocations.
A dispatch with no subscribers succeeds with count zero.

Publishers must await or handle the returned promise. There is no automatic error
sink, retry, or best-effort success conversion in the bus. Original thrown values
may contain application data; choose what to log. Bus shutdown waits for completion
but does not replay dispatch errors through `close()`.

## Correlation and follow-ups

Listeners receive frozen metadata: `id`, `name`, `emittedAt` in epoch milliseconds,
optional `correlationId`, optional `parentId`, and a typed `emit` method. A listener
registered with an AbortSignal additionally receives that same `signal`. The
correlation option is copied at admission; later caller mutation does not change it.

`await context.emit(OtherEvent, payload)` creates a child dispatch with a new ID,
the parent ID, and inherited correlation. Accepted listeners may use this method
while the bus is closing, and shutdown drains that child work too. New root calls
to `events.emit()` are rejected once closing begins. A context is valid until its
parent dispatch finishes; using its emitter later rejects `EventContextExpiredError`.
Use a new root emission for independent later work while the bus remains open.

## Ownership, boundaries, and verification

`on`/`once` return idempotent unsubscribe functions. `scope()` groups subscriptions;
`scope.close()` unsubscribes then drains callbacks already executing. `events.close()`
stops admission, drains accepted dispatches and their context-owned children, removes
subscriptions, and closes scopes. Both operations share their promise when repeated.
See [subscriptions and lifecycle](event-subscriptions.md) for ordering and usage.

These are in-process events: no persistent log, transaction outbox, retries,
cross-process/worker transport, exactly-once delivery, or implicit Worker lifetime
extension. Counts/listeners are local to an app instance. A process crash can lose
work. Await request-owned emissions; use platform lifetime APIs for work extending
beyond a Worker response. Durable queues remain a separate planned module.

Unit tests cover ordering, overlap, once reservation, removals, signals, scopes,
errors, immutable metadata, follow-ups, and shutdown. Compile-only tests reject
incorrect payloads/listeners. `pnpm test:events` runs the built package on actual
Node/Bun/Deno and browser-bundled workerd, then verifies task activity over TCP,
logs, shutdown, and restart behavior.
