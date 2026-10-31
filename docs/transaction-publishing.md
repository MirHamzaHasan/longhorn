# Atomic business writes and job publishing

Owner: `@longhornjs/queue/transaction`. Connects [typed queues](queues.md),
[managed transaction executors](transaction-executors.md),
[SQLite](sqlite-transaction-publishing.md), [PostgreSQL](postgres-transaction-publishing.md)
and [Object SQL/alarm projection](object-transaction-publishing.md).

```ts
import { enqueueInTransaction } from '@longhornjs/queue/transaction'

const result = await database.transaction(async (tx) => {
  const record = await repository.createIn(tx, input)
  const job = await enqueueInTransaction(queue, tx, { businessId: record.id })
  return { record, job }
})
// Return a successful HTTP response only after the outer transaction resolves.
```

The repository, queue/schema and input above belong to the application. Use the
same Database instance for the queue store and transaction. The helper validates
through that Queue's existing schema/JSON/byte/attempt limits and inserts through
its transactional store capability. It never calls a root enqueue, opens a nested
transaction, commits, or closes the database itself.

`enqueueInTransaction(queue, tx, data, options?)` preserves the queue's payload type
and existing delayMs/maxAttempts settings. Job IDs remain generated UUIDs. Timestamps
are captured after validation; delay is relative to that preparation time, not a
guaranteed interval after commit. Unsupported stores, root Database objects, cloned
executors, expired scopes and a different database owner reject without an independent
job commit. SQLite/PostgreSQL stores implement the capability; memory stores do not.

## Commit and failure boundaries

The helper's JobInfo is **provisional inside the callback**. It describes an inserted
row that can still roll back. Only the outer transaction's success confirms commit.
After success the worker can claim the job and observe the committed business row.
A failed business write, publication or final provider/alarm commit rolls back the
transaction. No new schema or migration is required for this producer path.

Accepted publication failures poison transaction completion even if the application
catches their Promise rejection. This includes payload validation, closed/unsupported
queues, wrong ownership and native insertion errors. Validate optional/domain input
before opening the transaction if the workflow may choose not to publish.

Return/await publications for clear error handling. Built-in providers also join
registered publications if the callback returns early: asynchronous validation and
insertion cannot continue after native commit. Ordinary detached work is not tracked
automatically. Queue close drains the admitted preparation/insertion; Database owns
the outer commit/rollback. See [executor lifetime](transaction-executors.md).

## Delivery and retry limits

This is one SQL transaction, not exactly-once execution or an external broker outbox.
A connection/process can disappear after commit but before acknowledgement; both
rows may already exist. Retrying a producer request can create another record/job
unless the application has its own idempotency key. Consumers still need idempotent
effects across lease recovery and retries. A producer span around only the helper
describes staging; wrap the outer transaction to observe its commit outcome.

See [the task/report HTTP path](task-report-transactions.md) and
[native visibility/crash proofs](transaction-publishing-testing.md).

For durable recovery of the producer's original result after a lost response,
[request idempotency](idempotency.md) now owns the outer transaction and invokes
this helper through its executor. The [task/report HTTP route](idempotency-http.md)
supports it with an optional key. It does not alter worker attempt/effect semantics.

[Transactional outboxes](outbox.md) also use this path for the outgoing record,
then publish through a separate host-owned dispatcher. The database transaction
does not enclose or commit the remote broker send. See [delivery windows](outbox-dispatcher.md)
and [stable consumer identity](outbox-consumer-deduplication.md).
