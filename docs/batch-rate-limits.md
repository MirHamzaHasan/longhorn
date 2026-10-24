# Atomic SQLite batch request limits

Owner: BatchSqliteRateLimitStore from @longhorn/ratelimit/batch-sqlite. Connects the
[limiter](request-limits.md), [server-time port](rate-limit-server-clock.md),
[D1 adapter](workers-d1.md), [schema](d1-limit-schema.md), [app](d1-request-limits.md)
and [native proof](d1-limit-testing.md). The package imports no Cloudflare/native module.

```ts
import { RateLimiter } from '@longhorn/ratelimit'
import { BatchSqliteRateLimitStore } from '@longhorn/ratelimit/batch-sqlite'
import { createD1 } from '@longhorn/workers/d1'
const database = createD1(env.DB) // binding or explicit D1 session
const limiter = new RateLimiter({
  scope: 'reports.submit.v1', limit: 20, windowMs: 60_000,
  store: new BatchSqliteRateLimitStore(database),
})
try { await limiter.consume('trusted-principal') }
finally { await limiter.close(); await database.close() }
```

Deploy the exported batchRateLimitMigrations before serving. The store requires a
SQLite BatchDatabase and uses one execute call for its native statement, never a
callback transaction. With createD1, execute sends that statement in one native
batch. Scope, subject digest and policy are bound parameters. Raw subjects remain
inside the existing coordinator's hashing boundary.

One INSERT/SELECT/UPSERT/RETURNING samples SQLite now and returns policy, count,
expiry and observed time. Expired rows start at one with a new deadline; matching
live policies increment up to limit+1 without extending it. A live policy conflict
performs no update and returns POLICY_MISMATCH without a follow-up read. Native
constraints/query/commit errors return no decision. Result counts, bounds and time
are validated before publication. There is no incomplete reservation row/claim.

The store declares clock='server', so the coordinator derives retry wait from
native observedAt and rejects an explicit now override. It uses the existing %s/%f
SQLite date functions rather than a newer optional subsecond modifier. Identical
now values within one SQLite step keep expiry and observation consistent; see
[SQLite time](https://www.sqlite.org/lang_datefunc.html),
[UPSERT](https://www.sqlite.org/lang_upsert.html) and
[RETURNING](https://www.sqlite.org/lang_returning.html).

Explicit prune(limit=100) removes an ordered bounded prefix of expired rows across
all scopes using native database time and the expiry index. Bounds are 1..10000.
Live windows are retained. It starts no timer, maintenance route or implicit
cleanup. The limiter borrows the provider; [close](d1-limit-lifecycle.md) drains it
before the host closes its D1 handle. Durable Object SQL and callback SQLite stores
keep their separate contracts; native evidence here is actual local workerd D1.
