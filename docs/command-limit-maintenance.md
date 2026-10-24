# Command budget maintenance tool

Owner: [maintain-limits.ts](../examples/postgres/src/maintain-limits.ts) and
[runLimitMaintenance](../examples/postgres/src/limit-maintenance.ts). Connects the
[command budget](command-request-limits.md), [cleanup API](rate-limit-cleanup.md),
[separate role](command-limit-maintenance-role.md), [lifetime](command-limit-maintenance-lifecycle.md),
[report](command-limit-maintenance-report.md) and [proof](command-limit-maintenance-testing.md).

This is an explicitly invoked native process, separate from the HTTP app. It has no
listener, command submission, migration or implicit grant operation. `check` verifies
its connection/schema/role without pruning. `once` performs exactly one bounded
batch and is the default. `watch` owns serial periodic batches until a stop signal.

```sh
# Workspace, after owner deployment and separate role provisioning:
pnpm maintain:command-limits check
pnpm maintain:command-limits once
pnpm maintain:command-limits watch
# Generated/archived command application:
pnpm maintain:limits check
pnpm maintain:limits
pnpm maintain:limits watch
```

Configuration comes from process environment over optional .maintenance.env.local
and .maintenance.env next to the example/generated project. It does not read the
HTTP .operator.env or owner .env files. DATABASE_URL and MIGRATION_DATABASE_URL
never substitute for MAINTENANCE_DATABASE_URL. The HTTP config rejects a supplied
MAINTENANCE_DATABASE_URL, keeping this credential in its own process/files.

| Setting | Default | Accepted value |
| --- | --- | --- |
| MAINTENANCE_DATABASE_URL | required | Same PostgreSQL TCP URL syntax as the native example |
| LIMIT_MAINTENANCE_LIMIT | 100 | decimal integer 1..10000 |
| LIMIT_MAINTENANCE_INTERVAL_MS | 60000 | decimal integer 1000..86400000 |
| LIMIT_MAINTENANCE_STATEMENT_TIMEOUT_MS | 30000 | decimal integer 1..60000 |

The process uses one native pool connection and the configured native statement
timeout. All settings validate before acquisition. watch waits after every batch,
including full batches, empties and errors. There is no catch-up spin or global
leader. Multiple owners retain the existing provider's SKIP LOCKED behavior.
Pruning is table-wide across scopes, not just account.commands.v1. Live budgets,
commands, queued deliveries, replay records and audits keep their current policy.

The archive/CLI ship editable source, build entries, package scripts, ignored private
files and three local feature guides. Existing owner migrations deploy the same
bucket table; no schema change is required. See [provisioning](command-limit-maintenance-role.md)
and [independent distribution verification](command-limit-maintenance-testing.md).
