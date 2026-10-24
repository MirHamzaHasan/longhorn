# Durable Worker reports

From the workspace root:

```sh
pnpm dev:durable-worker
curl -i http://127.0.0.1:3006/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
curl 'http://127.0.0.1:3006/cdn-cgi/mf/scheduled?cron=*+*+*+*+*'
```

Read the returned job Location for the result. Queue/schedule/result rows persist
in local Durable Object SQLite at `data/objects`; DURABLE_DATA_PATH chooses another
path. Ctrl+C releases workerd and leaves the data. The local trigger is a pinned
Miniflare control route, not a cloud deployment or automatic cron timer.

See [the full example](../../docs/workers-durable-example.md),
[provider](../../docs/workers-durable-sqlite.md),
[transaction ownership](../../docs/durable-sqlite-transactions.md),
[migrations](../../docs/durable-sqlite-migrations.md),
[queues](../../docs/workers-durable-queues.md),
[schedule dispatch](../../docs/workers-durable-scheduler.md) and
[native proofs](../../docs/workers-durable-testing.md). Each feature has its own guide.
Run `pnpm test:worker-storage` for actual SQL/restart/abort verification.
`wrangler.example.toml` illustrates the separate application-owned deployment setup.

For automatic processing through Object alarms, run `pnpm dev:alarm-worker` at
port 3008. It uses dist/alarms.js, adds the clock migration and retains data at
data/alarms (or ALARM_DATA_PATH). The launcher performs the pinned local runtime's
one-time startup activation; native alarms then process work without a manual
scheduled request. See [the alarm example](../../docs/alarm-report-example.md),
[recovery](../../docs/alarm-recovery.md) and [native proof](../../docs/workers-alarm-testing.md).
`wrangler.alarms.example.toml` illustrates the separate configuration without cron.

[Optional Object report budgets](../../docs/object-report-limits.md) share one quota
across direct and scheduled submissions, including the automatic-alarm profile:

```sh
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:durable-worker
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:alarm-worker
```

Run either host independently. Background reports still complete after HTTP quota
exhaustion. Run `pnpm test:object-rate-limits` for native concurrency, upgrade,
interruption and retained-host proof. Each part has its own guide:
[store](../../docs/object-request-limits.md), [deployment](../../docs/object-limit-deployment.md),
[lifecycle](../../docs/object-limit-lifecycle.md) and [verification](../../docs/object-limit-testing.md).
