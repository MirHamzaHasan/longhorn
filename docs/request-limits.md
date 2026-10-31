# Request attempt limits

Owner: @longhornjs/ratelimit. Connects the [memory provider](rate-limit-memory.md),
[SQL providers](rate-limit-sql.md), [Redis provider](redis-rate-limits.md), [native batch provider](batch-rate-limits.md), [Hono middleware](rate-limit-http.md),
[command application](command-request-limits.md) and [native proof](rate-limit-testing.md).
Authentication's login throttle remains separate and unchanged.

```ts
import { RateLimiter } from '@longhornjs/ratelimit'
import { MemoryRateLimitStore } from '@longhornjs/ratelimit/memory'
const limiter = new RateLimiter({
  scope: 'reports.submit.v1', limit: 20, windowMs: 60_000,
  store: new MemoryRateLimitStore({ maxEntries: 10_000 }),
})
const decision = await limiter.consume('trusted-account-id')
// allowed, remaining, resetsAt (epoch ms), retryAfterMs (0 when allowed)
await limiter.close()
```

Each subject has a window beginning with its first admitted attempt. Exactly limit
attempts are allowed; later attempts are denied without extending the deadline.
At now >= resetsAt a new window begins. This is a fixed window per subject, so
traffic can burst around its boundary. It is not a rolling window or token bucket.
Consumption commits before returning, including a denial. Later application errors
and idempotent retries do not refund an attempt.

Scope is 1..128 ASCII letters/digits plus . _ : / -, beginning with a letter/digit.
Limit defaults to 60 and is an integer 1..1000000; windowMs defaults to 60000 and is
1000..86400000. Subjects are nonempty well-formed Unicode, at most 1024 UTF-8 bytes.
The store receives SHA-256 over UTF-8 JSON ['longhorn.rate-limit.v1',scope,subject].
Raw subjects never enter the provider. Deterministic hashes are pseudonyms, not
secrets or encryption; guessable identities can still be tested offline.

All hosts sharing a scope/subject must agree on limit/window. Application-clock
stores also require synchronized host clocks; Redis uses its own [server time](rate-limit-server-clock.md). A live
window rejects a different policy with POLICY_MISMATCH; its expiry admits the new
policy. Explicitly versioning the scope starts a distinct budget. Backward wall
clock changes may extend a live wait, while forward changes can start a window.
Use trusted synchronized clocks for shared storage.

Input, capacity, closed, policy and provider-protocol failures are RateLimitError
with fixed codes/messages. Native storage errors retain their original identity.
The [HTTP adapter](rate-limit-http.md) hides them behind a generic 503.

[Lifecycle](rate-limit-lifecycle.md) owns admission and drain. There is no implicit
timer, listener, database acquisition, migration or cleanup. Node/Bun/Deno native SQLite and Node PostgreSQL use their managed stores. Actual
workerd D1 uses the optional server-timed batch provider. Durable Object SQL uses
the existing managed SQLite store and application clock. See [D1 proof](d1-limit-testing.md)
and [Object integration](object-request-limits.md).

The optional Redis provider borrows the existing Node command connection, uses one
atomic reservation and native expiry, and receives no client clock. An explicit
now override is invalid for a server-timed store. See [deployment](redis-rate-limit-deployment.md),
[working protected example](redis-rate-limit-example.md) and [proof](redis-rate-limit-testing.md).

[Optional owned cleanup](rate-limit-cleanup.md) schedules bounded pruning in native
hosts using the shared [prune worker](prune-worker.md). The [SQLite example](rate-limit-cleanup-example.md)
proves disabled/enabled retention and lifecycle; maintenance never refills live budgets.
