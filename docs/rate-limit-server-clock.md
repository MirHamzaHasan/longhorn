# Explicit server-owned rate limit time

Owner: ServerTimedRateLimitStore/ServerTimedRateLimit and the RateLimiter coordinator.
Connects [Redis](redis-rate-limits.md) without changing the existing
[memory](rate-limit-memory.md) or [SQL](rate-limit-sql.md) time protocol.

RateLimitStore retains its consume(request,now) callback. Its optional clock is
'application'; omitted clock preserves the original contract. SQLite/PostgreSQL
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
