# Object SQL transaction publishing and alarms

Owner: existing SQLite QueueStore over `@longhornjs/workers/durable-sqlite`, using
`@longhornjs/queue/transaction`. Connects [managed executors](transaction-executors.md),
[Object SQL](workers-durable-sqlite.md), [queue ownership](workers-durable-queues.md)
and [atomic alarm projection](alarm-wakeup-planning.md).

The same typed helper works inside an Object's database.transaction callback:
write the business row through tx, then enqueue through the same queue/database
instance. SQL work and the prepared job share one native storage.transaction.
The Object input gate excludes other events during that boundary. No Node APIs,
broker queue subscription or cross-Object transaction is introduced.

Accepted publishers drain before the Object provider runs its internal alarm commit
hook. With an active clock, the committed unit is:

```text
business SQL -> validated queue insert -> earliest wakeup projection
  -> native alarm write -> one commit
```

Validation/business/native alarm errors roll the whole unit back. A publication's
provisional JobInfo can exist inside the callback while the later alarm commit
still fails; return success only after the outer transaction. Running/delayed job
wakeup policy and persistent failure floors remain the alarm clock's contract.
No new schema is needed beyond existing queue and optional clock tables.

Public callback executors expire when the callback returns. Already accepted async
publishers use private checked executors until their validation/insertion finishes,
then expire too. A caught failed publication prevents commit. The provider never
re-enters a root database method to insert the job. Keep schemas pure/short because
the native input gate has its own lifetime policy.

Object queue state is private to its ID. A worker can consume the new job after
commit and find the business row; a lease/effect interruption still requires
idempotent handling. Cold local-host activation and managed platform discovery
remain distinct, as documented in [alarm recovery](alarm-recovery.md).

[Native proof](transaction-publishing-testing.md) uses actual Object SQL, not a memory
store. It fails validation/business work, throws after native setAlarm, and aborts
the Object in that window, then inspects raw persisted business/job/alarm state
before activation. It also holds asynchronous schema work open after callback
return, verifies restart persistence, and lets a real alarm consume the committed
business row exactly once in that tested attempt. No exactly-once delivery guarantee
is inferred from the effect count.
