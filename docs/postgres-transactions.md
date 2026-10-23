# PostgreSQL transaction ownership

Owner: `@longhorn/node/postgres`. Connects [pool leases](postgres.md),
[SQL executors](database.md), [migrations](postgres-migrations.md) and [lifecycle](lifecycle.md).

```ts
await database.transaction(async (tx) => {
  await tx.execute({ sql: 'UPDATE app.accounts SET balance=balance-$1 WHERE id=$2', args: ['10.00', from] })
  await tx.execute({ sql: 'UPDATE app.accounts SET balance=balance+$1 WHERE id=$2', args: ['10.00', to] })
})
```

One checked-out connection owns BEGIN ISOLATION LEVEL READ COMMITTED, callback
statements, and COMMIT/ROLLBACK. Root queries use independent pool leases. Calling
that same Database's execute/transaction/close from its active callback rejects
instead of accidentally escaping atomicity or waiting on its own single-client
pool. Use tx.execute. Calls through a different pool are separate transactions and
can contend at the database; no cross-pool atomicity is implied.

Callback statements queue sequentially on their client. The executor admits work
only while its callback is active; retained executors reject after the callback
returns. Accepted statements are drained before commit/rollback even when the caller
forgets to await them. Applications should still await results for domain logic.
Each transaction separately bounds pending statements by maxPending. A pre-admission
validation/capacity rejection sends no SQL; a server statement error marks the whole
transaction failed even if the callback catches its Promise rejection.

After callback success, the adapter waits for accepted statements, rejects a recorded
statement failure as PostgresTransactionAbortedError, and checks that PostgreSQL's
commit command actually committed. This prevents PostgreSQL's aborted-transaction
COMMIT/ROLLBACK behavior from being reported as success. Callback failure preserves
the original thrown value; rollback failure retains both errors in AggregateError.
The connection then resets or is destroyed if broken.

Direct BEGIN/START/COMMIT/END/ROLLBACK/ABORT/SAVEPOINT/RELEASE/PREPARE commands are
unsupported, including behind leading semicolons and leading/nested comments. Extended protocol also
rejects multi-statement scripts. SQL/procedure bodies remain trusted application
code; do not manage transactions inside them. Nested transactions, savepoint APIs,
custom isolation options and automatic retries are not implemented. Concurrent
updates need appropriate SQL locking/atomic expressions; read-then-write is not
automatically serialized across transactions.

Finished async context is expired, so later work scheduled after a callback may use
the root database normally. It is outside that earlier transaction. Close rejects
new root work and waits for every accepted operation, including callbacks and
session reset. A callback that never settles keeps close pending. Server idle-in-
transaction and statement/lock timeouts bound backend operations, not arbitrary JS.
Never await database.close from its transaction callback.

Native tests cover commit/rollback, caught statement errors, unawaited accepted work,
expired/reentrant contexts, sequential admission at capacity one, parameter snapshots,
timeouts, connection termination/reconnection and close while a transaction is held.
The implementation follows the [driver's same-client requirement](https://node-postgres.com/features/transactions).

The provider also creates a [managed executor scope](transaction-executors.md).
It seals the callback executor, joins accepted transaction publishers, then drains
statements before COMMIT. A caught publication failure prevents commit; abort
waits for accepted work before native rollback. Exact owner checks support
[atomic business/job writes](postgres-transaction-publishing.md) without leasing a
second connection. Existing timeout, statement-failure and uncertain-commit rules
still apply.
