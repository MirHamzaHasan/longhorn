# Command budget maintenance

This separate native process checks/prunes expired budget rows without giving the
HTTP runtime DELETE. First deploy the normal complete operations schema and
[provision a separate role](limit-maintenance-role.md). Copy .maintenance.env.example
to .maintenance.env and supply its private connection. Process environment wins
over .maintenance.env.local and .maintenance.env. The tool never falls back to the
HTTP DATABASE_URL or provisioning MIGRATION_DATABASE_URL.

```sh
pnpm maintain:limits check
pnpm maintain:limits       # default: one bounded batch
pnpm maintain:limits once
pnpm maintain:limits watch
```

LIMIT_MAINTENANCE_LIMIT defaults 100 (1..10000), INTERVAL_MS defaults 60000
(1000..86400000), STATEMENT_TIMEOUT_MS defaults 30000 (1..60000); all use the
LIMIT_MAINTENANCE_ prefix. Configuration validates before connecting. watch uses
one native connection and the same serial cleanup API as the framework. It waits
after each settled batch/error, including a full batch, and stops on a signal.

Pruning is table-wide across scopes, preserving live/exhausted budgets. Commands,
queue deliveries, request replay and audits are untouched. check is read-only;
none of these modes deploys migrations, grants privileges or opens an HTTP listener.
The ordinary HTTP start/dev/check commands install no maintenance task. They reject
a supplied MAINTENANCE_DATABASE_URL; keep it in the separate process/files.

See [role/profile](limit-maintenance-role.md), [reports and signals](limit-maintenance-report.md),
[existing budget behavior](request-limits.md) and [deployment](deployment.md).
