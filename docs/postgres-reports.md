# PostgreSQL background task reports

Owner: examples/postgres/src/reports.ts and background.ts. Connects [the tasks app](postgres-example.md),
[queue storage](queue-postgres.md), [schedule storage](scheduler-postgres.md), [DI](dependency-injection.md),
validation and [lifecycle](lifecycle.md).

```sh
pnpm demo:postgres
curl -X POST http://127.0.0.1:3003/task-reports \
  -H 'Content-Type: application/json' -d '{"scope":"all"}'
```

Use the returned Location to read job/report status. The native demo owns temporary
data and removes it on Ctrl+C. For a provisioned persistent database, run
migrate:postgres with owner credentials and grant resources before dev:postgres.
The postgresExampleMigrations export in migrations.ts preserves the original task migration prefix,
then appends queue, scheduler and task-report tables. Runtime never runs DDL.

| Route | Behavior |
| --- | --- |
| POST /task-reports | Validate scope (all/open/completed; default all), enqueue, 202 + Location |
| GET /task-reports/:id | Safe job metadata and report, or 404; report is null until its effect exists |
| POST /task-report-schedules | Register an immutable once/interval/UTC-cron definition, 200 + Location |
| GET /task-report-schedules/:id | Safe schedule metadata or 404 |
| DELETE /task-report-schedules/:id | Cancel an active cursor, 204; otherwise 404 |

```json
{
  "id": "hourly-tasks",
  "scope": "all",
  "schedule": { "kind": "cron", "expression": "0 * * * *" }
}
```

Once schedules require at (epoch milliseconds). Intervals accept intervalMs
(50–86400000), optional startAt and latest/catch-up missed policy. Cron uses the
shared five-field UTC parser with optional startAt/policy. Repeated identical IDs
preserve cursors; changed definitions return 409. Invalid schemas/cron return 400.
Bodies are limited to 8192 bytes. Status excludes payloads and lease tokens.

The worker runs postgres.task-reports.v1. One INSERT ... SELECT counts current
matching tasks in a statement snapshot and persists total/completed with job_id as
the primary key. ON CONFLICT DO NOTHING preserves the first effect across retries
after a crash. Reports return total, completed and open as exact decimal strings,
plus UTC PostgreSQL createdAt text. They reflect effect execution time, not enqueue
or scheduled time. A result can exist while the job still needs acknowledgement.

The executable defaults WORKER_ENABLED=true and SCHEDULER_ENABLED=true. Disable them
independently for producer-only/worker-only/timing hosts sharing one database. The
programmatic createPostgresApp defaults both timers off unless explicitly enabled.
DI connects PgDatabase to TaskReportQueue/TaskReportScheduler, then their worker/runner.
Shutdown drains HTTP, timing runner, handlers, scheduler and queue before closing the
pool; dependency checks and telemetry also close. SQL readiness checks all required
tables; it does not prove future handler success or measure backlog age.

Runtime grants include queue/schedule SELECT/INSERT/UPDATE and report SELECT/INSERT.
No report UPDATE/DELETE, queue/schedule DELETE, history reads or DDL are granted.
This public example shares one dataset; account/tenant authorization remains separate.
See [native proofs](postgres-background-testing.md) and [role setup](postgres-roles.md).

To create a task and its follow-up in one commit, use
[`POST /tasks/with-report`](task-report-transactions.md). The route joins the
existing report queue through [transaction publishing](postgres-transaction-publishing.md);
an insertion failure rolls back the task. The report still counts tasks when its
handler executes. Optional [request keys](idempotency-http.md) replay the original
committed task/job without another insertion.
