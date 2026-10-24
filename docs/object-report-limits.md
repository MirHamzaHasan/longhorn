# Optional Object report submission budget

Owner: [request-limits.ts](../examples/durable-worker/src/request-limits.ts).
Connects the shared [report app](workers-durable-example.md), its [alarm profile](alarm-report-example.md),
[typed configuration](../examples/durable-worker/src/config.ts), DI and the existing
[Object SQLite store](object-request-limits.md).

```sh
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:durable-worker
# Or the independent automatic-alarm profile:
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:alarm-worker
```

These launchers read the process environment; they do not load a dotenv file.
The scheduled profile defaults to port 3006, the alarm profile to 3008. Their
retained directories/namespaces are separate. Both Wrangler examples include the
same default-off vars for application-owned deployment.

| Binding | Default | Accepted value |
| --- | --- | --- |
| REPORT_LIMIT_ENABLED | false | literal true or false |
| REPORT_LIMIT_REQUESTS | 60 | decimal integer 1..1000000 |
| REPORT_LIMIT_WINDOW_MS | 60000 | decimal integer 1000..86400000 |

Both `POST /reports` and `POST /report-schedules` consume one shared per-Object
budget under scope `public.reports.submit.v1` and fixed server-selected subject
`application`. This public demo has no account/tenant authentication. Client IPs,
forwarded headers, request bodies and caller schedule IDs cannot choose another
budget. The public router selects the fixed Object name `reports`.

The 16 KiB body guard runs first. Consumption commits before JSON/schema validation
and immutable schedule registration. Invalid payloads, repeated schedules and
conflicts count; later business failure does not refund a committed attempt.
A denial returns 429 with Retry-After and no-store without inserting a job,
schedule or result. Store failure/policy mismatch returns the middleware's fixed
private 503. Reads, cancellation, health, scheduled processing and automatic alarms
consume no submission attempts. Already accepted reports still compute normally.

`ReportRequestLimits` is resolved at startup only when enabled. Disabled apps
install no limiter provider. They still migrate the complete appended schema and
preserve existing rows. Re-enabling retains an unexpired budget. Changing policy
under a live bucket fails closed until expiry; a deliberate new scope would create
a separate budget. Do not remove rows to toggle the feature.

Hosts validate all settings, including disabled numeric settings, before acquiring
Miniflare/storage. Direct Object construction uses the same schema and returns a
fixed configuration-unavailable 503 on failure without acquiring an app. The alarm
entrypoint also rejects invalid configuration without running work.
See [schema deployment](object-limit-deployment.md), [owned drain](object-limit-lifecycle.md)
and [verification](object-limit-testing.md).
