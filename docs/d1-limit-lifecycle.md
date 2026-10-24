# D1 limiter ownership and lost acknowledgements

Owners: RateLimiter, BatchSqliteRateLimitStore and the borrowed D1 handle.
Connects [generic drain](rate-limit-lifecycle.md), [D1 ownership](workers-d1.md),
[task integration](d1-request-limits.md) and [native evidence](d1-limit-testing.md).

The limiter registers accepted hashing/consume/prune before asynchronous work.
It neither acquires nor closes a binding, database or transaction. Store operations
use one existing provider execute call. RateLimiter.close stops admission and
awaits all accepted work; then the host can close its D1 handle. createD1.close
drains this handle and never deletes/closes the platform database itself.

The task app acquires/verifies its database before resolving the optional limiter.
Shutdown drains HTTP -> limiter -> database. Disabled configuration registers no
limiter. Native verification holds a real committed D1 result, closes the app while
its HTTP attempt is active, and checks that the database is still open. Releasing
the result lets the task finish before limiter/database release.

A native statement/batch failure rolls back its reservation. A reply or decoder
failure after commit is different: the attempt can remain stored even though no
decision is returned. The provider/coordinator never retry automatically, refund
or delete that state. Hono returns private 503; an explicit retry consumes another
attempt and can be denied. The native gate drops one actual post-commit binding
acknowledgement and proves one stored attempt, then one additional explicit retry.

HTTP cancellation and isolate termination do not undo already accepted remote SQL.
Local workerd restart retains counters and tasks in its owned D1 storage. Cooperative
in-process close is verified separately from abrupt platform lifetime. No timer,
platform scheduler, public reset, KV fallback or fake callback transaction starts
implicitly. See [batch clock](rate-limit-server-clock.md) and [schema](d1-limit-schema.md).
