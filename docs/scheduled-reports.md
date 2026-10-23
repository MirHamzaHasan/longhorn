# Scheduled report jobs

Owner: `examples/jobs/src/schedules.ts` and the jobs app. Connects [reports](jobs-example.md),
[durable schedules](scheduler.md), [UTC cron](cron.md), [timing hosts](scheduler-runner.md),
[SQLite dispatch](scheduler-sqlite.md), [queues](queues.md), and [workers](queue-workers.md).

```sh
pnpm dev:jobs
curl -i http://127.0.0.1:3002/report-schedules \
  -H 'Content-Type: application/json' \
  -d '{"id":"sample-every-minute","numbers":[2,4,6],"schedule":{"kind":"interval","intervalMs":60000,"missed":"latest"}}'
curl http://127.0.0.1:3002/report-schedules/sample-every-minute
curl -i -X DELETE http://127.0.0.1:3002/report-schedules/sample-every-minute
```

POST /report-schedules validates report numbers and a schedule definition, then
returns **200** with metadata and Location /report-schedules/:id. Explicit IDs
make identical registration retryable without resetting progress. Changed
definitions return 409. Without an ID each submission creates a new schedule.
Invalid numbers/timing/cron return 400 and oversized bodies return 413. The API
supports these schedule objects:

- `{ "kind": "once", "at": 1790000000000 }` with an epoch millisecond timestamp.
- `{ "kind": "interval", "intervalMs": 60000, "startAt": 1790000000000, "missed": "latest" }`.
- `{ "kind": "cron", "expression": "0 9 * * 1-5", "missed": "catch-up" }`, evaluated in UTC.

startAt/missed are optional for recurring schedules. This example restricts fixed
intervals to 50–86400000 ms; the library supports any representable positive integer.
GET /report-schedules/:id returns state, next occurrence, dispatch count and lastJobId
without payload/retry-budget storage fields. Follow that lastJobId at GET /reports/:id
for queue state and result. Schedule dispatch completion means a queue insertion;
it does not imply worker completion. DELETE returns 204 for active cancellation,
404 for unknown/inactive IDs. Already queued/running reports remain processable.
All normal responses use Cache-Control: no-store.

SCHEDULER_ENABLED defaults to true and independently controls the timing host.
WORKER_ENABLED independently controls execution. Disable both to register pending
schedules without processing, then restart with both true to dispatch/process them.
Every enabled scheduler host polls the shared database at 100 ms with a bounded
batch; SQLite coordinates duplicates across hosts. Missed=latest coalesces downtime;
catch-up preserves all due occurrences across batches. Polling has no exact-start SLA.

DI registers ReportScheduler and ReportScheduleRunner alongside the report queue,
worker and database. The old queue/report migration prefix is preserved, with
schedulerMigrations appended. Startup acquires DB -> Queue -> Scheduler -> Worker
-> Runner. Cleanup drains HTTP -> Runner -> Worker -> Scheduler -> Queue -> DB,
including startup rollback. Timers stop before workers drain, and committed queue
work remains durable if no consumer completes it before shutdown.

Report effects use stable job IDs for idempotency. Schedule definition changes,
payload factories, tenant authorization, pause/resume, listing, timezone support,
retention, job cancellation and administrative replay remain later capabilities.
This is a public local demonstration using its existing independent jobs.sqlite file.

App/storage tests cover registration/conflict, cancellation, validation, migration
prefix preservation, dispatch and timed execution. `pnpm test:scheduler` uses the
compiled host and temporary SQLite to register with timers disabled, restart to
dispatch/process, cancel, then restart again and confirm cancellation/results.
