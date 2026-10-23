# Durable alarm native verification

Owner: [verify-worker-alarms.mjs](../scripts/verify-worker-alarms.mjs) and
[alarm fixture](../scripts/fixtures/worker-alarms.mjs). Connects
[host API](workers-sqlite-alarms.md), [projection](alarm-wakeup-planning.md),
[schema](alarm-migrations.md), [recovery](alarm-recovery.md),
[reports](alarm-report-example.md) and [telemetry](alarm-telemetry.md).

```sh
pnpm test:worker-alarms
```

The command builds first. Actual Miniflare 3.20250718.3/workerd 1.20250718.0 executes
browser-bundled built exports in SQLite-backed Objects, compatibility date 2025-07-18.
Node 20.19+ hosts tooling/gates; it does not supply the Object's SQL engine or a
replacement alarm scheduler.

## Controlled native storage contracts

A future injected clock keeps alarms from firing during deterministic SQL cases.
Test-only direct clock.alarm calls verify lifecycle behavior; these are not labeled
native event deliveries. The real SQL/alarm backend proves:

- Earliest schedule registration, cancellation/moving to the next item, last-work
  deletion, updates through another database handle, and non-sliding status reads.
- A throw after native setAlarm rolls back both alarm and schedule. A real
  state.abort in that window reconstructs the Object; raw persisted inspection
  before activation confirms both old values survived. Activation refresh is
  checked separately within its one-millisecond tolerance.
- Missing-schema activation removes its hook, duplicate alarm ownership/wrong
  storage/options reject, and the 64-queue binding path works on the native engine.
- Recurring cursors rearm; two-item callback limits leave backlog for later runs;
  running lease expiry and delayed retry state select the next wakeup.
- The failure floor persists across a full host restart, then clears on success.
  A late startup failure rolls back without waiting on its pending startup alarm.
- An ignored budget retains its callback and resources through concurrent clock/
  app close; release permits recovery write and cleanup, and later admission rejects.

## Actual alarm delivery and interruption

Separate real-time cases observe an external gateway notification from native
alarm handlers. Resetting an Object before its due alarm is followed by a new
Object instance executing the persisted wakeup without an HTTP kick. Interruption
after effect commit leaves a running lease; another native alarm recovers attempt
two while keeping one idempotent effect. Five pending jobs also drain through
multiple actual two-item alarm invocations, leaving no idle alarm.

Whole standalone-host restart is a distinct case: this pinned local runtime needs
Object activation and a changed-time projection refresh to rebuild its timer index.
The test performs that one startup activation, then observes only the gateway until
the native alarm fires. It does not claim a cold unactivated local host discovers
every persisted Object. [Recovery](alarm-recovery.md) documents this limit and the
launcher's startup bootstrap.

## Compiled example and launcher

The compiled automatic report entrypoint processes immediate jobs and future
schedules without manual tick/cron requests. It verifies last-wakeup cancellation,
private control routes, fixed consumer spans/privacy and committed results after
host restart. The standalone launcher runs over TCP with a temporary ALARM_DATA_PATH,
waits for automatic completion and checks signal disposal/closed listener.

All fixture control/fault routes remain absent from the application. Finally blocks
release held I/O, owned processes and temporary SQL storage. Normal example data,
Cloudflare accounts and system services are untouched. Existing storage/queue/
scheduled/runtime/project gates protect the modified provider's default path and
CLI framework distribution. These tests prove the declared local compatibility
path, not live-account deployment or exactly-once execution.
