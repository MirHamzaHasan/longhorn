# Atomic PostgreSQL task and report request

Owner: `examples/postgres/src/app.ts`, PostgresTasksStore.createIn and
`@longhorn/queue/transaction`. Connects [tasks](postgres-example.md),
[report queue/worker](postgres-reports.md), [transaction ownership](transaction-executors.md)
and [PostgreSQL publishing](postgres-transaction-publishing.md).

```sh
pnpm demo:postgres
curl -i http://127.0.0.1:3003/tasks/with-report \
  -H 'Content-Type: application/json' -d '{"title":"Save the task and request its follow-up"}'
```

The temporary demo starts an owned server/app and removes its data on Ctrl+C.
Existing configured-server migration/dev commands also expose this route.

`POST /tasks/with-report` validates the same strict trimmed title as POST /tasks,
creates a task through the callback executor, and publishes an all-tasks report
job in that transaction. It returns **201** only after commit:

| Output | Meaning |
| --- | --- |
| JSON task | Committed task with string ID |
| JSON job | Producer snapshot of the queued follow-up |
| Location | `/tasks/:id` |
| Report-Location | `/task-reports/:jobId` |

Read the report location until the worker has produced its result. A fast worker
can already have advanced beyond the returned pending snapshot. With workers
disabled, both task and pending job persist for a later worker host. Normal POST
/tasks keeps its existing behavior and does not implicitly request a report.

The report counts current tasks when its handler executes. It is not a snapshot
of task counts at creation time and is not limited to the newly created task.
Concurrent writes can change those counts. The payload keeps the existing
postgres.task-reports.v1 scope schema, so no queue version/schema migration changes.

The DI chain uses the same PgDatabase for Tasks, TaskReportQueue and the enclosing
transaction. Startup checks existing tables; the runtime needs only its existing
restricted DML/sequence grants. A queue insertion failure rolls back the new task.
The native gate revokes that permission temporarily in its owned sandbox to prove
the actual HTTP failure path, then restores it.

An optional [Idempotency-Key header](idempotency-http.md) now preserves the original
committed task/job result for matching retries within its retention window. Its
request record participates in the same transaction. Without that header, losing
a response after commit can still lead a retry to create another pair. Report
effects retain their job-ID idempotency and at-least-once execution policy.
See [native HTTP/restart proof](transaction-publishing-testing.md).
