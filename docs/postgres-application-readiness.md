# Shared PostgreSQL application readiness checks

Owner: examples/postgres/src/postgres-readiness.ts, composed by app.ts and the
[operator preflight](operator-preflight.md). Connects [readiness](health-checks.md),
[account deployment](postgres-accounts.md), [command deployment](command-app-deployment.md)
and [verification](operator-preflight-testing.md).

checkPostgresTables(database, accounts?, operations?) requires the PostgreSQL
dialect and performs the existing five LIMIT 0 probes for tasks, reports, queue,
schedules and replay storage. With accounts present, it reuses account table and
selected password/session-function checks. With operations present, it reuses
command/history/view schema, index/function/access checks and optional cleanup
ledger authority. Account/operation feature selection retains its existing meaning.

Both application startup and /readyz call this one helper. The preflight selects
the native operator profile's enabled password/session/command capabilities.
This removes duplicate startup/probe SQL without replacing Hono, DI, lifecycle or
the existing store contracts. Deployed schema, migration history and grants are
unchanged. Runtime probes do not repair or migrate a database.

Checks observe the runtime-visible shape, configured capabilities and known
metadata privileges. Runtime credentials intentionally cannot read owner-only
migration history. A successful probe therefore does not certify that ledger's
checksums or exercise every business mutation grant. It neither acquires durable
authorization nor creates an isolation snapshot against concurrent deployment.
Operators deploy the complete immutable profile before starting updated hosts.
