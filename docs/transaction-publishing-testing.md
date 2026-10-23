# Transaction publishing native verification

Owner: [verify-transaction-publishing.mjs](../scripts/verify-transaction-publishing.mjs),
[process fixture](../scripts/fixtures/transaction-process.mjs) and
[Object fixture](../scripts/fixtures/transaction-worker.mjs). Connects
[API](transaction-publishing.md), [executors](transaction-executors.md),
[SQLite](sqlite-transaction-publishing.md), [PostgreSQL](postgres-transaction-publishing.md),
[Object SQL](object-transaction-publishing.md) and [HTTP](task-report-transactions.md).

```sh
pnpm test:transaction-publishing
```

The command builds first. It uses temporary native SQLite, owned PostgreSQL 18.4
with separate owner/runtime roles, and pinned Miniflare 3.20250718.3/workerd
1.20250718.0 (compatibility date 2025-07-18). No normal database or cloud account is used.

## Native database/process proofs

Independent writer processes pause after both writes but before commit. Another
connection/process observes neither the business row nor job. SIGKILL at that point
rolls both back. SIGKILL after commit preserves both even though the writer never
finishes its acknowledgement. Competing producers create distinct business/job
pairs, and a consumer reads the committed business row. SQLite uses separate
processes so its same-process file gate does not mask visibility behavior.

Both engines additionally join unawaited asynchronous schema work through queue
close and transaction completion, and roll back a business write after a caught
validation failure. PostgreSQL uses the restricted application role. The compiled
task/report HTTP path returns committed locations, survives producer-host restart
into a worker, and produces the report. Revoking queue INSERT makes that HTTP
request fail without retaining its task; the permission is restored afterward.

## Object SQL and wakeup proofs

Actual Object SQL commits a business row, job and optional alarm together. The gate
tests caught invalid payloads, later business exceptions, a throw after native alarm
write, and state.abort in that window. Raw persisted inspection before activation
checks that all three rolled back. A schema I/O gate proves a callback returning
early cannot commit ahead of its accepted publisher. Rows survive host restart,
and a real native alarm consumes a new committed job while reading its business row.
The normal alarm host's documented local activation boundary remains unchanged.

## Source contracts and regressions

[Executor tests](../packages/database/src/transactions.test.ts) cover runtime owner
identity, frozen/expired public and descendant executors, ordered original failures,
synchronous registration, sealed admission and abort drain.
[SQLite integration tests](../examples/jobs/src/transaction.test.ts) cover atomic
success/rollback, async publisher drain, caught validation failure, wrong/expired/
cloned/root scopes, unsupported stores and closed queues. Compile-only negatives
retain the queue's payload type for the new helper.

Existing full PostgreSQL/provider/auth/background, queue/scheduler, Object storage/
alarm and generated-project/runtime gates protect changed transaction paths and
distributed entrypoints. Cleanup joins owned children/pools/hosts and removes only
temporary data. These checks do not prove external-broker atomic delivery,
request idempotency or exactly-once execution.
