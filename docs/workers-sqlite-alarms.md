# Durable Object alarm timing host

Owner: `@longhorn/workers/sqlite-alarms`. Connects [Object SQL](workers-durable-sqlite.md),
[managed work](application-work.md), existing SQLite queue/scheduler tables,
[wakeup planning](alarm-wakeup-planning.md), [recovery](alarm-recovery.md) and
[consumer telemetry](alarm-telemetry.md).

```ts
const database = createDurableSqlite(state)
const clock = createSqliteAlarmClock(state, {
  database, application: app, queues: ['reports.v1'], batchSize: 10,
  handle: async ({ signal, limit, info }) => {
    signal.throwIfAborted()
    await processBoundedReports({ limit, signal, info })
  },
})
app.onStart(async () => {
  await migrate(database, completeMigrationHistory)
  return () => database.close()
})
app.onStart(async () => { await clock.start(); return () => clock.close() })
// Acquire queue/scheduler resources after the clock, so they close before it.
// The Object's native method returns clock.alarm(info).
```

The app, report callback and complete history above are application-owned. Include
[alarmClockMigrations](alarm-migrations.md) after the deployed history. Constructing
the borrowed database and clock performs no SQL; start follows migrations. See
[the runnable report host](alarm-report-example.md) for complete DI/lifecycle wiring.

## Options and entrypoints

| Option | Default | Contract |
| --- | --- | --- |
| database | Required | A createDurableSqlite handle for this exact Object storage |
| application | Required | TaskApplication/app.run lifecycle ownership |
| queues | Required | 1–64 unique existing queue names, copied at construction |
| handle | Required | Await bounded processing and all descendants |
| batchSize | 10 | Integer 1–1000, supplied to handle as limit |
| minDelayMs | 100 | Integer 1–60000, minimum new wakeup lead time |
| failureDelayMs | 1000 | Integer 1–3600000, persisted Object-wide failure floor |
| timeoutMs | 30000 | Integer 1–900000, cooperative invocation budget |
| now | Date.now | Valid nonnegative integer Date-range clock |

Use the same time source for the clock, queues and scheduler when injecting one.
Queue names match `[A-Za-z0-9._-]{1,100}`. Options/functions are captured during
construction. One active clock exclusively owns the Object's alarm; multiple
clocks, another provider's database or another storage object reject. The callback
must process every configured queue or deliberately defer it. The supplied limit
does not count arbitrary business operations inside user code.

`start()` is memoized, installs atomic wakeup planning and reconciles stored work.
`reconcile()` repairs the current projection after start. `alarm(info?)` returns
the app.run-owned native completion. Retry metadata is the original object, with
nonnegative retryCount/boolean isRetry; omitted metadata defaults to 0/false for
older tooling. Concurrent manual invocations coalesce onto the same pending Promise.
There is no HTTP execution context or synthetic waitUntil: the Object returns the
actual alarm Promise to the platform.

The budget begins before shared app startup and includes processing, telemetry and
final SQL rearm. Abort is cooperative. An ignored signal retains actual work and
resources until settlement; successful return after expiry becomes failure.
Original processing errors remain original errors, unless recovery rearm also fails,
in which case an AggregateError retains both.

`close()` stops admission, drains entered work/reconciliation, performs a final
projection and removes this clock's hook. Stop dependent writers first and close
the database after the clock. Persisted wakeups are retained for remaining work;
close is not schedule cancellation or an eviction callback. Never await close from
its own callback. Startup rollback does not wait for the alarm still awaiting that
startup, avoiding a lifecycle self-dependency.

`stats()` exposes started, active, pending, runs, failed, timedOut, coalesced,
closing/closed. These counters reset with the instance and omit payloads, queue
names and retained errors. `getAlarm()` reads the platform's current timestamp/null;
it can be null during an active alarm and is a diagnostic snapshot, not a lease.
See [native proofs](workers-alarm-testing.md) and
[Cloudflare's alarm contract](https://developers.cloudflare.com/durable-objects/api/alarms/).
