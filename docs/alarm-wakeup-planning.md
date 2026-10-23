# Atomic SQL-to-alarm wakeup planning

Owner: `@longhorn/workers/sqlite-alarms` with an internal commit extension in
`@longhorn/workers/durable-sqlite`. Connects [schedule cursors](workers-durable-scheduler.md),
[queue ownership](workers-durable-queues.md), [schema history](alarm-migrations.md)
and [Object alarm lifetime](workers-sqlite-alarms.md).

The next durable wakeup is the earliest of these timestamps in configured queues:

| State | Wakeup source |
| --- | --- |
| Active schedule | next_at |
| Pending/delayed/retrying job | available_at |
| Running job | lease_until |
| Succeeded/failed job or completed/cancelled schedule | No wakeup |

A single CTE binds up to 64 queue names once, then finds the minimum over these
existing tables. The persistent failure floor can postpone that minimum. A new
wakeup is clamped to at least now + minDelayMs. New earlier work replaces a later
alarm; cancelling the earliest schedule moves to the next item; removing the last
work item deletes the projected alarm. Completed queue effects retain their own
idempotency policy.

## Commit boundary

Starting the clock installs one internal hook per storage object. Every successful
root provider operation runs that hook before native transaction commit, including
operations from another createDurableSqlite handle over the same binding. The hook
uses a private transaction executor, not a reentrant root call. SQL mutation,
retry-floor changes and native alarm set/delete share one storage.transaction.
There is no gap between acknowledging a schedule/job write and arming its wakeup.

A thrown callback never reaches the hook. A failed hook/native alarm write rolls
back the SQL operation and alarm mutation together. The Object's input gate excludes
other client events during this boundary; ordinary failures are caught inside that
gate before being rethrown. Direct raw storage SQL/alarms bypass this discipline;
all managed writers must use the provider. Database operations without a clock
keep their existing behavior.

The example's ownership chain is:

```text
Queue/Scheduler mutation -> Database transaction -> SQL state
  -> internal alarm projection -> native setAlarm/deleteAlarm -> one commit
```

## Reads and activation

Read operations also reconcile. An already adequate earlier wakeup stays fixed,
so frequent status reads do not keep pushing due work forward. Wakeups are hints:
Scheduler and queue claims still enforce exact due/lease state before processing.
Duplicate, early or delayed native alarm invocations cannot by themselves insert
duplicate schedule occurrences.

On activation the clock refreshes an existing projection. The pinned local runtime
can retain the SQL alarm value while losing its timer index across a whole-host
restart; a same-value set can be coalesced. Activation changes a matching timestamp
by one millisecond and subsequent reads retain that tolerance. At the maximum
representable timestamp the adjustment is earlier; SQL due checks still govern
execution. Later writes can move the wakeup to a genuinely new earliest item.
See [recovery and local startup](alarm-recovery.md).

Queue/schedule/retry timestamps must fit the nonnegative JavaScript Date range.
Unprojectable values reject the entire mutation rather than committing work with
no valid alarm. The clock owns one Object alarm exclusively, covering every queue
it is configured to process; it is not a cross-Object discovery or fanout service.
[Native tests](workers-alarm-testing.md) prove rollback after a real alarm write,
interruption before commit, multiple handles, no sliding deadlines and 64 scopes.
