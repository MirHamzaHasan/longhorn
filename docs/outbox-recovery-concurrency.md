# Retry revisions, leases and retention races

Owner: `packages/outbox/src/recovery.ts` and native SQL providers. Connects
[retry](outbox-deliberate-retry.md), [retention](outbox-retention.md),
[Object wakeups](alarm-wakeup-planning.md) and [native proof](outbox-recovery-testing.md).

The recovery UPDATE predicates queue, ID, failed state, observed max_attempts and
the resulting <=100 ceiling. It changes state/budget/timing and clears lease fields
in one native statement with an explicit metadata RETURNING projection. Under
concurrent requests only one can change the failed row. Others cannot match its
new state or raised ceiling. Cumulative attempts and immutable message identity
avoid resetting retry history or creating an ABA match after another failure.

PostgreSQL's [UPDATE](https://www.postgresql.org/docs/18/sql-update.html) evaluates
its predicate and returns changed rows under native concurrency rules; its
[READ COMMITTED behavior](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)
rechecks changed rows after waiting. SQLite serializes native writers and supports
[UPDATE RETURNING](https://www.sqlite.org/lang_returning.html). LongHorn proves the
algorithm with separate real processes, not an in-memory application mutex.

If no row changed, a second metadata SELECT distinguishes missing, conflict and
budget exhaustion. That diagnostic snapshot can itself change afterward; only
scheduled asserts this operation performed the transition. Database errors still
propagate. A commit/connection failure can have an ambiguous outcome, so inspect
the same ID before issuing another deliberate action.

Pruning and retry both act atomically on native rows. If pruning wins, retry finds
no message and never recreates it. If retry wins, the record becomes pending and
terminal cleanup cannot delete it. PostgreSQL cleanup skips locked rows; SQLite
serializes its delete with writers. No fallback inserts or new IDs are used.

A stale publisher from an expired final lease cannot acknowledge a retried record.
The old token is cleared, and the next claim creates a new one; existing ownership
predicates fence the old completion. This cannot revoke remote acceptance. The
consumer still needs stable-ID deduplication across deliberate and automatic retries.

The Object provider composes the status UPDATE with its native alarm projection.
An actual Object abort after setAlarm rolls the budget/state/wakeup back together.
A committed retry survives host restart and can be consumed by an automatic alarm.
Outbox close joins admitted list/retry operations; HTTP/app.run or the operator host
must own the full call before releasing the database.
