# Durable request idempotency

Owner: `@longhornjs/idempotency`. Connects [transactions](database.md),
[validated job publishing](transaction-publishing.md), [JSON fingerprints](idempotency-json.md),
[SQL records/retention](idempotency-storage.md) and [HTTP retries](idempotency-http.md).

The optional [batch-sqlite API](batch-idempotency.md) separately supports SQLite
BatchDatabase providers such as D1 using predeclared SQL and a known JSON result.
It does not implement this callback contract or change its retention policy.

```ts
import { Idempotency } from '@longhornjs/idempotency'
import { SqliteIdempotencyStore } from '@longhornjs/idempotency/sqlite'
import { enqueueInTransaction } from '@longhornjs/queue/transaction'

const requests = new Idempotency({ store: new SqliteIdempotencyStore(database) })
const outcome = await requests.run({
  scope: 'tenant:42:create-task:v1', // derive tenant/operation/version on the server
  key: clientKey,
  input: { title: validatedTitle },
}, async tx => {
  const task = await tasks.createIn(tx, validatedTitle)
  const job = await enqueueInTransaction(queue, tx, { taskId: task.id })
  return { task, job }
})
// outcome.value is the original committed JSON result, including on replay.
// outcome.replayed identifies replay; outcome.expiresAt is epoch milliseconds.
```

The store opens the transaction. Use its callback executor for business writes and
the same Database object for repositories/transactional queue storage. Do not wrap
run in another database.transaction or use the root database inside the callback.
Accepted job publications finish before commit through managed transaction scopes.
Neither a provisional callback result nor its job is a committed success until run
resolves. A commit/connection failure can still have an ambiguous outcome; retry
with the same scope, key and input to discover the committed record.

| Existing record | Behavior |
| --- | --- |
| Missing | Execute work; commit business writes, jobs and result together |
| Unexpired, same fingerprint | Return saved result; do not execute work |
| Unexpired, different fingerprint | Throw IdempotencyConflictError |
| Expired at or before current time | Execute a new generation; replace result atomically |
| Work/publish/serialization fails | Roll back everything; a later retry can execute |

Competing callers serialize through native SQL ownership, including expiry reuse.
No durable pending/busy lease is committed. A crash before commit releases native
ownership and leaves no partial request. A crash after commit retains the response.
There is no automatic retry loop for database lock/capacity/connection failures.

Scopes and keys are case-sensitive. Scope is 1–200 ASCII characters beginning with
an alphanumeric, then alphanumeric or `._:/-`; key allows alphanumeric or `._:-`
after its initial alphanumeric. validIdempotencyKey validates keys. Choose a
new operation version when input/result meaning changes. A scope must include the
authenticated principal/tenant when results are private; a client-supplied scope
does not enforce authorization. The public example intentionally shares a dataset.

Defaults: 24-hour retention, 16 KiB input, 64 KiB result, Date.now clock. Retention
may be 1 ms–30 days; input/result limits may be 1 byte–1 MiB. Results must be strict
JSON. Services/stores borrow database lifetime and create no timer or connection.
HTTP/app.run owns the full operation; close the database after its callers drain.

Request idempotency covers same-database work. External effects belong in a
transactionally published job with an idempotent handler. Queue attempts remain
at-least-once. Deleting/expiring records permits another execution and does not
delete existing tasks, jobs or results. See [SQLite](idempotency-sqlite.md),
[PostgreSQL](idempotency-postgres.md), [Object SQL](idempotency-workers.md) and
[native proofs](idempotency-testing.md).

[Outbox](outbox.md) can be staged in the same callback to recover producer intent
and later publish through a broker. The [command pipeline](outbox-worker-example.md)
persists command, request result and outgoing ID together; consumer receipts use
that ID to handle remote redelivery. Request replay retention and consumer
deduplication retention remain separate policies.

Optional [owned cleanup](idempotency-cleanup.md) schedules bounded prune calls through
the existing lifecycle, leaving import/construction and logical retention unchanged.
