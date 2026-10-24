# Request attempt limits

Owner: @longhorn/ratelimit. Connects the [memory provider](rate-limit-memory.md),
[SQL providers](rate-limit-sql.md), [Hono middleware](rate-limit-http.md),
[command application](command-request-limits.md) and [native proof](rate-limit-testing.md).
Authentication's login throttle remains separate and unchanged.

```ts
import { RateLimiter } from '@longhorn/ratelimit'
import { MemoryRateLimitStore } from '@longhorn/ratelimit/memory'
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

All hosts sharing a scope/subject must agree on limit/window and clocks. A live
window rejects a different policy with POLICY_MISMATCH; its expiry admits the new
policy. Explicitly versioning the scope starts a distinct budget. Backward wall
clock changes may extend a live wait, while forward changes can start a window.
Use trusted synchronized clocks for shared storage.

Input, capacity, closed, policy and provider-protocol failures are RateLimitError
with fixed codes/messages. Native storage errors retain their original identity.
The [HTTP adapter](rate-limit-http.md) hides them behind a generic 503.

[Lifecycle](rate-limit-lifecycle.md) owns admission and drain. There is no implicit
timer, listener, database acquisition, migration or cleanup. D1 and Durable Object
SQL adapters are not implemented for this package. Node/Bun/Deno native SQLite and
Node PostgreSQL are verified; workerd uses the finite memory/Hono contract.
