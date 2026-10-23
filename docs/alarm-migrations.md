# Alarm clock schema history

Owner: `alarmClockMigrations` from `@longhorn/workers/sqlite-alarms`. Connects
[shared migration history](durable-sqlite-migrations.md), [wakeup planning](alarm-wakeup-planning.md)
and [failure recovery](alarm-recovery.md).

```ts
await migrate(database, [
  ...deployedApplicationHistory,
  ...alarmClockMigrations,
])
await clock.start()
```

The complete history must already include queueMigrations and schedulerMigrations.
Append this export after the deployed prefix; do not independently migrate each
module list, reorder prior entries, or rewrite checksummed statements. The report
alarm host uses its existing queue -> scheduler -> report prefix and appends the
clock migration, leaving the manual-host history unchanged.

`longhorn_worker_alarm/001_clock` creates a strict longhorn_alarm_clock table with
one constrained ID=1 row and nonnegative retry_after. That row is the Object-wide
failure floor, initially zero. No job payloads, errors, tokens, queue names or
telemetry are stored there. Queue/schedule tables retain their existing protocols.
Every Object has its own history and floor.

Start installs the projection only after all tables and this row exist. Missing
schema fails activation and removes its hook, so it cannot poison unrelated future
provider calls. Startup rollback closes acquired resources. Later activation can
use a new clock instance after the complete schema has been applied. This is not an
automatic schema repair or a downgrade path.

Cloudflare class migration declarations remain separate from SQL migrations.
`wrangler.alarms.example.toml` illustrates a new SQLite-backed ReportAlarmCoordinator
class without a Cron Trigger. The local launcher uses its own persistent namespace
path, separate from the manual cron report demo. Rebinding an existing deployed
class/storage to a new entrypoint requires application-owned rollout planning;
switching demo commands does not migrate another namespace's data.

[Native verification](workers-alarm-testing.md) exercises missing-schema activation,
hook release, ordered startup rollback and persisted floor/rows across Object and
host reconstruction. The shared migration module continues to enforce ordered
checksummed history and transaction rollback.
