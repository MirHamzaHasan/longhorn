# Request limiter ownership

Owner: RateLimiter admission in @longhorn/ratelimit. Connects [stores](rate-limit-sql.md)
and [middleware](rate-limit-http.md) to the existing application lifecycle.

consume and prune register accepted work before hashing, provider callbacks or any
asynchronous step. Inputs/options are copied or captured. Reentrant close sees
that work. close is idempotent, stops further admission with CLOSED and awaits all
previously accepted hashing, SQL/native work and maintenance settlement. Original
provider errors remain on their caller promises; drain does not raise them again.
Do not await close from inside a callback being drained by that same limiter.

The limiter borrows its store. It owns no pool, listener, timer or process and
never closes the borrowed database. Acquire database -> limiter, then shut down
HTTP -> limiter -> database. Abort of an HTTP request does not pretend to cancel
admitted native SQL. Keep the database alive until that work settles.

The [command application](command-request-limits.md) resolves PgCommandLimits at
startup only when configured, registers its cleanup as an acquired resource and
uses existing reverse release. Disabled hosts install no limiter provider. Native
verification holds a real PostgreSQL row lock, starts a request and closes the
app; HTTP/limiter/pool shutdown waits for the lock to release. A package test also
checks close called synchronously from an admitted provider. See [proof](rate-limit-testing.md).

[Server-timed providers](rate-limit-server-clock.md) join the same admission/drain
without sampling the application clock. The [Redis store](redis-rate-limit-lifecycle.md)
borrows its command connection; close never deletes native TTL keys or retries an
ambiguous committed reservation.

[D1 batch storage](d1-limit-lifecycle.md) joins the same server-time admission and
drain, borrowing its existing atomic handle. Native batch rollback differs from a
lost post-commit acknowledgement; neither path is automatically retried.
