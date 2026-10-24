# Private maintenance report v1

Owner: LimitMaintenanceReport in [limit-maintenance.ts](../examples/postgres/src/limit-maintenance.ts).
Connects [modes/configuration](command-limit-maintenance.md),
[shutdown](command-limit-maintenance-lifecycle.md) and [native/installed proof](command-limit-maintenance-testing.md).

Valid commands write one final JSON record with exactly these fields:

| Field | Meaning |
| --- | --- |
| schemaVersion | 1 |
| mode | check, once or watch |
| ok | Mode completed/drained successfully with no observed batch/observer failure |
| cancelled | Its stop signal was received |
| runs | Admitted prune calls; check is zero |
| removed | Successful acknowledged deletion count |
| errors | Failed batch count; startup/release failure instead makes ok false |
| observerErrors | Failed awaited watch error observers |

watch also emits `{schemaVersion:1,event:"started",mode:"watch"}` after startup
checks/resources succeed. It is an acquisition observation, not a durable heartbeat
or a promise that the first batch has finished. Fixed warnings/errors go to stderr.
No URL, username, password, role, subject hash, scope, command data, row contents,
provider error text or request headers are copied into reports/warnings.

check/once return exit 0 on success, 1 on configuration/access/query/release failure,
130 on SIGINT and 143 on SIGTERM. Interruption wins the CLI exit status while the
final record still reports acknowledged removals and errors. watch treats a signal
as its normal stop: exit 0 if it drained without observed errors, otherwise 1.
Recovery after an earlier failed batch does not erase that failure count.

Unknown modes or extra arguments return exit 1 with fixed usage text before
configuration or database acquisition and have no final report. Aggregate counts
reset with the process; they are not backlog size, a retained audit or a snapshot
of every expired row. There is no continuous JSON event stream of private keys.
