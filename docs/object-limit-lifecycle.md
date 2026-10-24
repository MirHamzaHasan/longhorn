# Object request budget ownership and alarms

Owners: the existing RateLimiter admission/drain, managed Object Database and the
report app lifecycle. Connects [limiter lifetime](rate-limit-lifecycle.md),
[Object transactions](durable-sqlite-transactions.md), [report policy](object-report-limits.md)
and [alarm wakeup planning](alarm-wakeup-planning.md).

The report app acquires database, optional clock, queue, scheduler and optional
limiter in that order. Accepted HTTP work drains before reverse cleanup:

```text
HTTP -> limiter -> scheduler -> queue -> optional clock -> database
```

The limiter borrows its store/database. Closing it blocks new consumption, waits
for accepted hashing, SQL and pruning, and never deletes bucket rows. Database
close drains its accepted native work and syncs; it does not close/delete the
platform's storage binding. Another managed handle can use that binding afterward.
Do not await limiter/app close from inside a callback that the same close must
drain. Initiating close there without awaiting it is supported and tested.

The Object input gate delays other event continuations during the owned native
transaction. Verification therefore initiates reentrant shutdown inside that
transaction and holds an external gateway until the caller proves shutdown is
pending. A same-Object timer observed after the gate opens cannot establish what
happened while the gate was held.

An Object abort before quota commit rolls back the attempt. An abort after commit
can lose the response while retaining the reservation; an explicit retry consumes
again and may be denied. There is no automatic retry/refund for an ambiguous
acknowledgement. Native rows, rather than in-memory counters, retain this state
across actor reconstruction and separate workerd host processes.

In the alarm profile the existing all-handle commit hook still projects wakeups
after quota SQL commits. It derives work only from schedules, pending/retrying jobs,
leases and the persistent failure floor. Bucket expiry is not an alarm candidate.
Invalid submissions or a quota-only transaction create no report alarm; a denial
does not slide an already adequate future wakeup. Legitimate queue/schedule changes
and cold-activation repair retain their existing projection rules.

Background processing bypasses the submission middleware. It runs the real
scheduler/queue/report handler even when the HTTP budget is exhausted. Read-only
status inspection can still invoke the existing managed SQL/alarm projection; the
budget does not suppress that behavior. There is no new maintenance alarm or timer.
See [native drain, interruption and automatic result proof](object-limit-testing.md).
