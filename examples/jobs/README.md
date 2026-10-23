# Report jobs

Run `pnpm dev:jobs` from the repository root. The public local API listens on
http://127.0.0.1:3002, enqueues POST /reports requests, and serves GET /reports/:id
status/results. Data persists in this example's data/jobs.sqlite.
Register/read/cancel one-time, interval and UTC-cron schedules through
/report-schedules; see [scheduled reports](../../docs/scheduled-reports.md).
Inspect /livez, /readyz, /metrics, /traces and /diagnostics for
[dependency/background observations](../../docs/jobs-observability.md).

See [the feature guide](../../docs/jobs-example.md) for commands, configuration,
DI/lifecycle connections, idempotency, persistence and verification. Queue contracts,
workers, memory storage and SQLite storage each have their own linked guide.

[Remote OTLP tracing](../../docs/jobs-otlp.md) is opt-in via the explicit trace endpoint;
without it the local memory buffer remains. `pnpm demo:tracing` starts an owned native
collector and temporary reports API at port 3004. [Configuration](../../docs/otlp-configuration.md),
[delivery](../../docs/otlp-delivery.md), [JSON mapping](../../docs/otlp-json.md) and
[native proofs](../../docs/otlp-native.md) document the connections and limits.
