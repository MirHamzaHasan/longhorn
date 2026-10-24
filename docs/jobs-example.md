# Persistent report jobs example

Owner: `examples/jobs`. Connects [HTTP](http.md), [validation](validation.md),
[configuration](configuration.md), [DI](dependency-injection.md), [lifecycle](lifecycle.md),
[queues](queues.md), [workers](queue-workers.md), and [SQLite queue storage](queue-sqlite.md).
This public loopback demo has a separate database from tasks/auth.

Local computation is the default. Optional [Rust computation](jobs-native-reports.md)
uses the same queue/result schema through ReportCompute DI. Run
`pnpm demo:rust-reports` for the [complete native workflow](rust-reports-demo.md).
`pnpm dev:jobs-native` instead runs the [persistent owned host](native-jobs-host.md),
acquiring and draining Rust as a lifecycle resource while retaining jobs/results.

```sh
pnpm dev:jobs
curl -i http://127.0.0.1:3002/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
# Use the job.id returned above:
curl http://127.0.0.1:3002/reports/JOB_ID
```

POST /reports accepts 1–1000 finite numbers from -1e12 to 1e12. Unknown fields and
invalid JSON/schema input return 400; bodies over 65536 bytes return 413. It
validates and durably enqueues before returning **202** with job metadata and a
Location header. GET /reports/:id returns job status and `report: null` until a
result exists; missing jobs return 404. Responses use Cache-Control: no-store.
No payload or lease token is returned. `/health` reports the configured worker/scheduler flags,
not a general storage/consumer readiness probe.
Explicit /livez, /readyz, /metrics, /traces and /diagnostics endpoints now expose
separate [dependency/background observations](jobs-observability.md).

The `reports.v1` handler calculates count/sum/min/max. It writes the result using
job ID as a unique key and ON CONFLICT DO NOTHING before queue acknowledgement.
A repeated execution of that same job preserves one result. Submission retries
still enqueue distinct jobs. Result and job acknowledgement are separate commits:
a result can already exist while status remains running/retrying. This demonstrates
idempotent effects across an at-least-once boundary.

Configuration uses optional `.env` and `.env.local` from examples/jobs, overridden
by process environment. Keys: HOST (127.0.0.1), PORT (3002; 0 chooses a free port),
LOG_LEVEL (info), DATABASE_PATH (`./data/jobs.sqlite` relative to examples/jobs),
WORKER_ENABLED and SCHEDULER_ENABLED (both `true` or `false`, default true). `:memory:` explicitly disables
disk persistence. With WORKER_ENABLED=false, HTTP enqueues/reads work but does not
consume it. Restart with the flag true or run another enabled host sharing the file.
Every enabled host contributes two consumer slots with a 100 ms empty-poll delay.
SCHEDULER_ENABLED independently controls schedule polling; see [scheduled reports](scheduled-reports.md)
for registration, UTC cron, missed-run policies and cancellation commands.
SHUTDOWN_GRACE_MS (0–10000, default 0) optionally holds an unready pre-close window;
it is separate from handler/export timeouts. See [observability wiring](jobs-observability.md).

Database startup preserves the queueMigrations/reportMigrations prefix and appends
schedulerMigrations. DI registers the database, queue, scheduler, worker and timing
runner and readiness, with JobsDiagnostics providing metrics/traces/checks. Startup
acquires DB -> queue -> scheduler -> worker -> runner -> readiness, and cleanup drains
HTTP -> readiness -> runner -> worker -> scheduler -> queue -> DB, then final telemetry.
Workers log
operational failure categories without payloads, tokens or raw provider causes.
Graceful shutdown waits for accepted jobs; a forceful crash leaves leased jobs for
later recovery. The default queue lease is 30 seconds, with renewal while working.

The app tests cover validation/status, idempotent results and lifecycle polling.
`pnpm test:queues` runs the compiled host over TCP with temporary files, enqueues
with the worker disabled, restarts to process, then restarts again to verify results.
Separate-process fixtures cover concurrent consumers, retries and SIGKILL recovery.
It never changes normal example data. Auth, tenant ownership, outbox coupling,
retention, job cancellation and custom provider integrations remain later features.
Schedules are implemented separately with their own [feature guide](scheduled-reports.md).
