# Alarm interruption, retry and startup recovery

Owner: the [alarm clock](workers-sqlite-alarms.md), [atomic projection](alarm-wakeup-planning.md)
and platform alarm service. Connects [queue leases](workers-durable-queues.md),
[schema metadata](alarm-migrations.md), lifecycle and effect idempotency.

## Durable recovery paths

If an operation is interrupted before commit, its SQL and alarm writes roll back
together. A committed schedule still has its cursor and wakeup. A dispatched job
retains its available time, or its lease deadline while owned by a handler. Object
reconstruction needs no in-memory runner state: the clock plans from those rows.

When processing fails or its cooperative budget expires, the clock persists
retry_after = now + failureDelayMs and projects the remaining work in the same
transaction. This floor applies to all managed queues in the Object. It survives
reconstruction and prevents an immediate due-work spin on repeated failure. The
next entered alarm clears it before processing. Individual queue retry times,
lease fencing and maximum attempts remain the queue protocol's decisions.

The original failure still rejects the native invocation. If recovery rearm fails
too, both errors are retained in an AggregateError and native failure policy applies.
The clock cannot guarantee progress through a permanent storage outage, platform
termination or exhausted native retries. Cloudflare owns alarm delivery/retry;
see [its alarm contract](https://developers.cloudflare.com/durable-objects/api/alarms/).

A crash after effect commit and before acknowledgement can repeat the handler.
The report effect inserts once per stable job ID. A later alarm wakes at the running
lease deadline, recovers ownership, sees/preserves that result and acknowledges.
No alarm flag makes an external effect exactly once, and cancellation cannot
remove a job already committed by dispatch.

## Object restart versus local host restart

Native tests reset an Object before its due alarm and observe its reconstructed
handler through an external notification, without an HTTP kick. They also interrupt
after an effect commit and verify lease recovery with one result row. This exercises
actual native alarm delivery, not a direct call to a method named alarm.

The pinned standalone Miniflare 3.20250718.3/workerd 1.20250718.0 host has an additional
cold-process limitation: stored SQL/alarm timestamps survive, but its alarm timer
index is not restored just by opening the host. Even a same-time set can be
coalesced. A known Object must be activated and its projection refreshed with a
changed timestamp. The local launcher performs one startup /health activation and
the clock's activation refresh restores the projection. Processing is then driven
by native alarms; the launcher installs no cron poller or persistent Node timer.

Custom local hosts must activate their known Objects after a cold host restart.
This is not a general discovery mechanism for arbitrary Object IDs. Cloudflare's
managed service owns its alarm discovery; this repository does not deploy an
account or use local cold-host behavior to assert remote failover guarantees.

## Lifecycle recovery

Alarm admission includes shared app startup. Cleanup drains entered work while
avoiding a wait on an invocation still awaiting that same startup. A later startup
hook can therefore fail and roll resources back without deadlocking clock close.
An ignored AbortSignal keeps its real callback, recovery write and resources owned
until settlement. Neither close nor timeout silently abandons storage users.
Stop scheduler/queue writers before clock close, then close the borrowed database.
See [native proofs](workers-alarm-testing.md) for each interruption boundary.
