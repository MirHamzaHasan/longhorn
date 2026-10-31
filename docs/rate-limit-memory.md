# Bounded memory request limits

Owner: MemoryRateLimitStore in @longhornjs/ratelimit/memory. Implements
[RateLimitStore](request-limits.md) using a Map and an indexed minimum heap.

maxEntries defaults to 10000 and accepts 1..100000. One entry represents one
scope/hashed subject, including its policy and expiry. Concurrent calls serialize
the synchronous reservation before resolving their promises. A denied bucket
saturates at limit+1 and retains its original expiry. Active policy mismatch fails
without modifying it.

At capacity, a new subject removes at most one already expired bucket. If every
entry is live, it throws CAPACITY; it never drops an active limit to admit a new
identity. The caller can fail closed or route the error through [Hono](rate-limit-http.md).
A target bucket resets directly when expired. Heap indices allow arbitrary target
replacement without scanning all subjects or accumulating stale heap entries.

RateLimiter.prune(limit=100) removes at most the requested expired heap roots.
Bounds are 1..10000 and removal is table-wide across all scopes in this store.
There are no timers. Hosts own maintenance and the [limiter lifetime](rate-limit-lifecycle.md).

Memory is per store/process, lost on restart and unsuitable for an aggregate
multi-host budget. Distinct instances only share state when passed the same store.
Use [SQL](rate-limit-sql.md) for retained/shared windows. Native contract proof
covers capacity preservation, expiry, policy conflicts and bounded pruning; see
[verification](rate-limit-testing.md).
