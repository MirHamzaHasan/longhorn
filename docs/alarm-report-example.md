# Automatic alarm report example

Owner: [examples/durable-worker/src/alarms.ts](../examples/durable-worker/src/alarms.ts).
Connects the existing report app/DI/lifecycle and SQL stores to
[Object alarms](workers-sqlite-alarms.md), [atomic wakeups](alarm-wakeup-planning.md),
[recovery](alarm-recovery.md) and [consumer tracing](alarm-telemetry.md).

```sh
pnpm dev:alarm-worker
curl -i http://127.0.0.1:3008/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
curl -i http://127.0.0.1:3008/report-schedules \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[1,3,5],"at":0}'
curl http://127.0.0.1:3008/report-schedules/first
curl http://127.0.0.1:3008/alarm
curl http://127.0.0.1:3008/alarm-traces
```

Poll the report Location until its result is available. A completed schedule points
to its lastJobId at `/reports/:id`. Work wakes automatically; no manual scheduled
control request is required. For a future one-time schedule use an epoch-millisecond
at value. The shared HTTP validation, 16 KiB body bound, numbers schema and public
single-workspace scope remain those of the [durable report app](workers-durable-example.md).

## Wiring

```text
HTTP -> named ReportAlarmCoordinator -> shared report app
  -> complete migrations -> clock.start -> queue/scheduler DI
  -> enqueue/register/cancel + atomic native alarm projection
native alarm -> clock.alarm -> app.run -> DI consumer span
  -> tick(limit: 10) + up to 10 runOnce attempts
  -> stable SQL report effect -> acknowledgement -> tracer.flush -> final projection
```

The new build emits dist/alarms.js alongside the existing manual cron dist/index.js.
Both reuse createReportApp and runReportBatch; the alarm variant appends the clock
migration and acquires clock ownership before queue/scheduler resources. Cleanup
closes scheduler -> queue -> clock -> database, with shared tracing closed last.
It configures one managed report queue, ten-item batches and a twenty-second
cooperative alarm budget. SQL leases/retries create wakeups for abandoned/delayed
jobs, not only new schedule definitions. Remaining backlog keeps a near-future alarm.

`/alarm` exposes runtime counters and the platform timestamp/null; `/alarm-traces`
shows bounded fixed-name consumer spans. `/_tick` is not exposed by the outer app.
There is no long-lived polling worker, Cron Trigger, public alarm execution route,
broker subscription or cross-Object fanout in this host.

## Local persistence

HOST/PORT choose the listener, default 127.0.0.1:3008. ALARM_DATA_PATH chooses Object
storage, default `examples/durable-worker/data/alarms`, separate from the manual
cron demo's data/objects. Ctrl+C disposes the host and leaves these rows. Startup
activates the known report Object once to restore the pinned local runtime's alarm
projection; see [cold-host recovery](alarm-recovery.md). This bootstrap does not run
the report processor directly.

`wrangler.alarms.example.toml` illustrates the separate application-owned deployment
binding/class migration and omits cron configuration. No account resources are
created or deployed by these commands. [Native verification](workers-alarm-testing.md)
uses temporary paths, automatic event delivery, failure windows and restart.
