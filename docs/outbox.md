# Transactional outgoing messages

Owner: `@longhornjs/outbox`. Connects [durable queues](queues.md),
[managed publishing](transaction-publishing.md), [request replay](idempotency.md),
[dispatch ownership](outbox-dispatcher.md) and [consumer deduplication](outbox-consumer-deduplication.md).

```ts
import { Outbox } from '@longhornjs/outbox'
import { SqliteOutboxStore } from '@longhornjs/outbox/sqlite'

const outgoing = new Outbox({
  name: 'orders.created.v1', schema: orderCreatedSchema,
  store: new SqliteOutboxStore(database),
})
const result = await requests.run({ scope: 'tenant:42:create-order:v1', key, input }, async tx => {
  const order = await orders.createIn(tx, input)
  const delivery = await outgoing.enqueueInTransaction(tx, { orderId: order.id })
  return { order, delivery }
})
```

Outbox composes the existing Queue engine instead of introducing another lease or
transaction implementation. Its topic is name; records use the dedicated queue
name `outbox.${name}`. Names allow 1–93 ASCII alphanumeric or `._-` characters.
Choose a versioned name/schema and reserve that queue for this Outbox publisher.
Do not run an ordinary domain handler against those outgoing records.

enqueueInTransaction uses the queue's validation/JSON/size limits and the exact
database-owned transaction executor. Business state and outgoing record commit
together; caught publication failures still prevent commit. enqueue is available
for a standalone outgoing record without a business transaction. Returned JobInfo
is provisional until its caller-owned transaction commits. Request idempotency
can save that original result across client retries.

| API | Purpose |
| --- | --- |
| enqueueInTransaction(tx,data,options) | Stage with business/request writes |
| enqueue(data,options) | Create a standalone durable outgoing record |
| get(id) | JobInfo snapshot without payload/lease token |
| list({state,limit,after}) | Bounded metadata pages, failed state by default |
| retryFailed(id,{expectedMaxAttempts,additionalAttempts,delayMs}) | Conditional failed-to-pending retry with cumulative attempt budget |
| retryFailedAudited(id,{...,actor,reason}) | Same transition and its action/result record in one transaction |
| auditHistory({deliveryId,limit,after}) | Bounded scoped recovery history |
| pruneAudit({before,limit}) | Independent explicit audit retention |
| dispatchOnce(publisher,options) | Claim one committed record, publish, conditionally acknowledge |
| createDispatcher(publisher,options) | Create an unstarted lifecycle-owned QueueWorker |
| prune({before,limit,includeFailed}) | Explicit bounded terminal cleanup |
| close() | Stop admission and join admitted queue/prune work; borrows database lifetime |

The publisher receives `{id,topic,data}` plus `{attempt,maxAttempts,signal}`. id
is the durable job ID and stays identical across publish retries/restarts. The
broker may assign a new transport ID to each send. Resolve publish only after
remote acceptance, and preserve the application ID in the broker envelope.

Status reuses JobInfo: pending, running, succeeded, failed. succeeded means remote
acceptance followed by a committed local acknowledgement; it does not mean a
consumer completed. An ambiguous send/ack can deliver before a retry or even leave
a terminal failed row despite remote acceptance. There is no cross-system commit
or exactly-once promise. See [dispatcher](outbox-dispatcher.md),
[SQLite](outbox-sqlite.md), [PostgreSQL](outbox-postgres.md),
[retention](outbox-retention.md), [binding adapter](workers-outbox-publisher.md),
[working pipeline](outbox-worker-example.md) and [native proofs](outbox-testing.md).

[Inspection](outbox-inspection.md) and [deliberate retry](outbox-deliberate-retry.md)
are optional store capabilities implemented by both built-in SQL stores. Retry
preserves the message identity and lifetime attempt count, raises the observed
ceiling as its revision and refuses competing/stale actions. The example exposes
these through [opt-in authorized operations](outbox-operations-http.md).

The optional [audit capability](outbox-audit.md) adds attributed recovery,
[durable history](outbox-audit-history.md) and [separate retention](outbox-audit-retention.md).
The operations demo now selects that transactional path; ordinary library retry
remains available. Apply its [schema/grants](outbox-audit-storage.md) before opting in.

The optional [HTTP publisher](outbox-http-publisher.md) sends stable envelopes to
a synchronous acknowledged receiver. The [persistent account host](persistent-operator-host.md)
connects it to protected Object SQL receipts while preserving existing retry and
transaction ownership. Its [native gate](persistent-operations-testing.md) proves
interruption after remote commit and restart recovery.
