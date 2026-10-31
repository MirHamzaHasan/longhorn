# PostgreSQL transaction publishing

Owner: `PostgresQueueStore.enqueueInTransaction` through
`@longhornjs/queue/transaction`. Connects [PostgreSQL transactions](postgres-transactions.md),
[queue storage](queue-postgres.md), [executor provenance](transaction-executors.md)
and restricted application repositories.

```ts
const result = await database.transaction(async (tx) => {
  const task = await tasks.createIn(tx, title)
  const job = await enqueueInTransaction(reportQueue, tx, { scope: 'all' })
  return { task, job }
})
```

The task/report services above use one original Database instance. The provider
leases one connection and begins its existing READ COMMITTED transaction. The store
checks that the supplied scope is active and belongs to that instance, then uses
the existing parameterized PostgreSQL job insertion. A different pool/Database
handle is rejected even if its connection string addresses the same server. No
second connection, implicit transaction or dialect translation is used to publish.

Accepted publishers drain before the provider seals statement admission and commits.
Its existing statement-failure/rollback rules remain; caught publisher validation
failures also prevent commit. A callback can return early without allowing schema
validation/insertion to race native commit. Callback/participant executors expire
at their respective boundaries. See [transaction ownership](transaction-executors.md).

Other sessions cannot read the uncommitted task/job. Workers observe the job after
commit, alongside the business change. Row locks are held until completion, so do
remote calls/prevalidation outside the transaction and keep schema logic short.
The API adds no automatic transaction retry. Native commit/connection ambiguity
retains the [provider's documented policy](postgres-transactions.md).

No production migration is added. The runtime role needs the business table's DML
and sequence permissions plus SELECT/INSERT on longhorn_queue.jobs. The example
already has those narrow grants; it uses no superuser/DDL permission to publish.
Removing queue INSERT permission causes the task/job transaction to roll back.

See [task/report HTTP](task-report-transactions.md). [Native PostgreSQL tests](transaction-publishing-testing.md)
use the owned server, restricted roles, independent observers/processes, concurrent
producers, async/caught-failure cases and SIGKILL before/after commit. External
broker delivery, distributed transactions and request idempotency remain separate.
