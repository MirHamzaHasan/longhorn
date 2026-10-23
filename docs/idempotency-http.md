# Idempotent task/report HTTP requests

Owner: `examples/postgres/src/app.ts`, TaskRequests DI provider and the existing
[`POST /tasks/with-report`](task-report-transactions.md) route. Connects
[request service](idempotency.md), [PostgreSQL records](idempotency-postgres.md),
[report jobs](postgres-reports.md) and [role setup](postgres-roles.md).

```sh
pnpm demo:postgres
curl -i http://127.0.0.1:3003/tasks/with-report \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: create-task-123' \
  -d '{"title":"Ship retry-safe task creation"}'
```

Repeat the request with the same key and title to get the original task/job with
201. The example's header names/status policy are application choices, not a
claim of conformance to an HTTP idempotency-key standard.

| Response | Meaning |
| --- | --- |
| 201, Idempotency-Replayed: false | New task/job/request record committed |
| 201, Idempotency-Replayed: true | Original committed JSON replayed |
| Idempotency-Expires-At | Original retention deadline in epoch milliseconds |
| Location / Report-Location | Original task / report-job location on creation and replay |
| 409 | Same unexpired key, different normalized title |
| 400 | Invalid body or invalid key; no request record |
| 500 | Unhandled work/database failure; retry may resolve an ambiguous commit |

The optional header accepts 1–200 ASCII characters: initial alphanumeric, followed
by alphanumeric or `._:-`. Empty, space/comma-containing and overlong keys fail.
Without a key the existing atomic task/job route executes normally and does not
store/replay a request record. POST /tasks and standalone report/schedule routes
keep their own behavior.

The existing strict schema trims the title before fingerprinting, so whitespace
variants of the same normalized title replay. Unknown fields are rejected before
the service. The server fixes scope to public:tasks-with-report:v1. Public tasks
share a dataset, so this scope is not a private account authorization mechanism.
Authenticated applications must scope their own results by principal/tenant.

TaskRequests borrows the same PgDatabase as Tasks and TaskReportQueue. The service
transaction encloses task creation, validated publication and saved JSON. The app's
owner migration history appends request storage; startup/readiness check that table.
Its runtime role gets the ledger DML privileges listed in the role guide. A job
INSERT permission failure removes the task and request record; a restored-permission
retry with the same key executes successfully.

Retention is 24 hours from callback completion and is not renewed on replay. No
automatic pruning timer is started. After expiry, the same key may create another
task/job. Replays return the historical pending producer snapshot; follow
Report-Location for the live job/result. Reports still count all tasks when the
worker executes. Worker effects retain their job-ID idempotency policy.
See [two-host, restart and failure proof](idempotency-testing.md).
