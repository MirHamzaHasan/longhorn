# Durable Worker reports example

Owner: [examples/durable-worker](../examples/durable-worker/src/index.ts). Connects
core/Hono/DI/lifecycle, [Object SQL](workers-durable-sqlite.md),
[migrations](durable-sqlite-migrations.md), [queues](workers-durable-queues.md),
[schedule storage](workers-durable-scheduler.md), validation and the scheduled adapter.

## Run

```sh
pnpm dev:durable-worker
curl -i http://127.0.0.1:3006/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
curl -i http://127.0.0.1:3006/report-schedules \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[1,3,5],"at":0}'
curl 'http://127.0.0.1:3006/cdn-cgi/mf/scheduled?cron=*+*+*+*+*'
curl http://127.0.0.1:3006/report-schedules/first
```

Read the job via the Location header from POST /reports, and the scheduled job via
the completed schedule's lastJobId. Trigger again to drain another bounded batch.
`HOST`/`PORT` select the address; PORT=0 prints an available port. Local trigger
URL `/cdn-cgi/mf/scheduled` is specific to pinned Miniflare 3.20250718.3, invokes
actual workerd, and is not a production HTTP API. The host installs no cron timer.

Local Object storage persists at `examples/durable-worker/data/objects` across
launcher restarts. `DURABLE_DATA_PATH` explicitly chooses another host path. Unlike
the transient [KV audit example](workers-scheduled-example.md), these queue/schedule/
result rows persist together. Ctrl+C disposes the local host and leaves that data.
The native gate selects temporary paths and never touches this example database.

## Connection chain

```text
outer Longhorn HTTP -> REPORTS namespace -> named Object "reports"
  -> Object-owned Longhorn app -> startup migrations -> DI database/queue/scheduler
  -> validated report enqueue / once-schedule registration / status / cancellation

platform scheduled event -> bounded outer adapter -> awaited Object /_tick
  -> scheduler.tick(limit: 10): occurrence + cursor in one SQL transaction
  -> up to 10 Queue.runOnce: claim -> idempotent SQL result -> acknowledgement
  -> Object response/body -> platform completion
```

The Object class exports a Fetch handler without Node imports. Every reconstructed
instance gets a fresh app/lifecycle; its SQL rows carry state across reconstruction.
Cleanup order is scheduler -> queue -> provider; the platform still owns eviction.
The outer scheduled handler admits one invocation per instance with a twenty-second
cooperative budget and does not close the shared app per event.

| Route | Behavior |
| --- | --- |
| GET `/health` | Starts/checks the named Object; identifies storage |
| POST `/reports` | Strict numbers payload, 202 plus Location |
| GET `/reports/:id` | Job metadata and result/null, 404 if absent |
| POST `/report-schedules` | Immutable caller ID, numbers and once `at`, 201/409 |
| GET `/report-schedules/:id` | Durable definition/cursor/state |
| DELETE `/report-schedules/:id` | Cancel active future dispatch, 204/404 |

Bodies are bounded to 16 KiB; arrays contain 1–100 finite numbers in ±1e12.
Responses use no-store. Reports compute count/sum/min/max and preserve one SQL effect
per job ID. These public demonstration APIs have no account/tenant boundary; the
single fixed Object name represents this example's shared workspace.

The store supports the portable scheduler's other timings; this HTTP example
exposes once schedules only. A tick does not promise to finish the backlog. Error
attempts remain subject to persisted queue retry/lease rules and later triggers.
There is no long-lived polling worker, alarm installation, cloud deployment, remote
trace exporter or cross-Object transaction. `wrangler.example.toml` illustrates
application-owned class migrations, namespace binding and Cron Trigger configuration.
See [native verification](workers-durable-testing.md).

`pnpm dev:alarm-worker` runs the same report application with an additional
[alarm timing host](workers-sqlite-alarms.md), appended schema metadata and its own
persistent local namespace. It processes due schedules and pending/retrying/leased
jobs through native alarms instead of this entrypoint's outer cron tick. See
[the automatic example](alarm-report-example.md) and [recovery limits](alarm-recovery.md).
