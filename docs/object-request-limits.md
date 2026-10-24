# Durable Object SQLite request limits

Owner: the existing `SqliteRateLimitStore` from `@longhorn/ratelimit/sqlite`, over
`createDurableSqlite` from `@longhorn/workers/durable-sqlite`. Connects the
[portable limiter](request-limits.md), [managed SQL protocol](rate-limit-sql.md),
[report policy](object-report-limits.md) and [native proof](object-limit-testing.md).
No additional provider or platform-specific limiter port is needed.

```ts
import { RateLimiter } from '@longhorn/ratelimit'
import { SqliteRateLimitStore, rateLimitMigrations } from '@longhorn/ratelimit/sqlite'
import { createDurableSqlite } from '@longhorn/workers/durable-sqlite'
import { migrate } from '@longhorn/database'
const database = createDurableSqlite(state)
await migrate(database, rateLimitMigrations) // standalone limiter-only Object
const limiter = new RateLimiter({
  scope: 'reports.submit.v1', limit: 20, windowMs: 60_000,
  store: new SqliteRateLimitStore(database),
})
const decision = await limiter.consume('trusted-principal')
await limiter.close()
await database.close()
```

An existing application must instead append the bucket migration after its complete
historical profile; see [deployment](object-limit-deployment.md). The snippet owns
only the limiter schema. Database acquisition, migrations, cleanup and shutdown
remain explicit application responsibilities.

Each Object has a private native database. Its shared managed gate, platform input
gate and native transaction serialize the claim, clock sample, policy check and
counter update. The application clock is sampled exactly once after native write
ownership, including when an event waited behind another Object transaction.
This is the existing application-clock store; D1's server-timed BatchDatabase
provider has a separate contract. Use trusted clocks and consistent policies.

Scopes and hashed subjects isolate buckets within that Object. The hash does not
make guessable identities secret. Identically named scopes in different Objects
have independent budgets; namespace-wide quotas require routing every relevant
request to the same owner or an additional coordination design.

Native SQL/policy failure rolls back without publishing a decision. Ordinary
failure is caught inside the input gate and does not deliberately reset the Object.
Counts saturate at limit+1, denials preserve expiry, and live policy changes fail
closed. Explicit `prune(limit)` deletes only a bounded expired prefix across scopes.
No cleanup timer or public reset endpoint is installed. See [lifetime and alarm
interaction](object-limit-lifecycle.md).
