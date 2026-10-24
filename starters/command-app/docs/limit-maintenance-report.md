# Maintenance reports and signals

[The command](limit-maintenance.md) emits one final JSON object with schemaVersion=1,
mode, ok, cancelled, runs, removed, errors and observerErrors. check has zero runs;
once admits exactly one bounded prune; watch aggregates its owned serial batches.
The record includes no credentials, roles, scopes, hashes, payloads or SQL errors.
watch first emits a separate fixed started event after acquisition/checks.

check/once exit 0 on success, 1 on failure, 130 on SIGINT and 143 on SIGTERM. watch
uses a signal as normal shutdown: 0 when drained without errors, otherwise 1.
Recovered watch failures remain counted. Startup/release failure makes ok false
even if no batch failed. Counts are in-memory observations, not a durable audit or
backlog size. Unknown modes/extra arguments fail with fixed usage before connecting.

Signals stop admission and idle waits. They do not fake native query cancellation.
A blocked admitted prune keeps the process/pool alive until actual settlement,
including its native timeout. A cancelled once can report committed removals;
a hard kill can lose the acknowledgement of committed work. No automatic retry or
refund is promised. Shutdown order is cleanup -> limiter -> database after managed
work drains. No private database or key details appear in failure warnings.
