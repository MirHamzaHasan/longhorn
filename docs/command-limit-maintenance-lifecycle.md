# Maintenance process lifetime and interruption

Owner: runLimitMaintenance. Connects [Longhorn lifecycle](lifecycle.md),
[cleanup ownership](rate-limit-cleanup-lifecycle.md), [tool](command-limit-maintenance.md)
and [report/exit behavior](command-limit-maintenance-report.md).

The coordinator loads typed configuration before acquisition, then owns a Longhorn
app with database -> limiter -> optional cleanup startup resources. It checks the
separate role/schema before admitting pruning. check starts no prune. once awaits
one limiter.prune(limit) through app.run. watch owns RateLimitCleanup and waits for
its explicit AbortSignal. watch without a stop signal is rejected programmatically.

No SQL callback, error observer or pool is detached. Shutdown drains managed work,
then cleanup -> limiter -> database in reverse order. Failed startup closes a newly
opened database before returning a private report. Later acquisition/observation/
close failures cannot leave ok=true. The read-only access check never borrows owner
credentials or deploys schema as a recovery path.

SIGINT/SIGTERM request stop; they do not pretend to cancel admitted native SQL.
If interruption arrives before configuration/acquisition or before prune admission,
no batch starts. If it arrives during a native batch, the process waits for the
actual query to settle and drains its pool. A committed deletion can therefore be
reported even in a cancelled once run. An external hard kill can lose a committed
acknowledgement; there is no automatic retry or rollback claim after commitment.

watch does not overlap batches and waits its configured interval after settlement.
Provider errors are observed with a fixed data-free warning, counted and retried
after the interval. Restoring a withdrawn grant can let later batches succeed;
final ok remains false if that owner observed batch errors. Idle signal stop
cancels the wait without creating another batch. The native statement timeout and
provider lock timeout bound actual database work; no synthetic timeout reports
unfinished work as closed.

Signal handlers are installed before native startup and removed after the final
report. The tool opens no HTTP listener or receiver. Scheduling watch under a
supervisor, or scheduling once externally, remains an explicit deployment choice.
