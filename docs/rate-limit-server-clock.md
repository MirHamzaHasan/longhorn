# Explicit server-owned rate limit time

Owner: ServerTimedRateLimitStore/ServerTimedRateLimit and the RateLimiter coordinator.
Connects [Redis](redis-rate-limits.md) without changing the existing
[memory](rate-limit-memory.md) or [SQL](rate-limit-sql.md) time protocol.

RateLimitStore retains its original shape and consume(request,now) callback, so
custom providers can keep private implementation fields such as clock. SQLite/PostgreSQL
sample that callback once after native ownership and before commit. prune receives
application now plus its bounded limit. Existing custom providers remain valid.

ServerTimedRateLimitStore declares readonly clock='server'. Its consume(request)
receives only the copied scoped/hash/policy reservation and returns allowed,
remaining, resetsAt and observedAt. The provider must sample observedAt atomically
with its reservation and publish the result after commitment. prune receives only
limit. The exported RateLimitStorage union accepts either provider contract.

RateLimiter captures the clock mode on construction. It rejects an explicit now
option for server-timed stores rather than ignoring a test/deployment clock. It
validates observedAt as a nonnegative safe integer with representable window end,
then validates the existing decision fields against that sampled time. Retry wait
is resetsAt-observedAt on denial, independent of application wall time. Public
RateLimitDecision retains its original fields and does not expose observedAt.
Server providers use no application clock for maintenance either.

Server time is wall time, not a monotonic distributed clock. A Redis clock jump,
restart with skew or inconsistent replicated state can change expiry behavior.
Deploy synchronized time and the required persistence policy. This contract does
not promise failover consistency, exactly-once attempts or client cancellation of
already accepted server work. See [lifetime](redis-rate-limit-lifecycle.md) and
[native server queue/expiry proof](redis-rate-limit-testing.md).

The optional [SQLite batch provider](batch-rate-limits.md) also uses this port. One
native UPSERT samples database time and returns the committed observation. Its
bounded prune statement samples the same database clock rather than taking host
now. [Native D1 proof](d1-limit-testing.md) runs with JavaScript Date.now set to zero.
