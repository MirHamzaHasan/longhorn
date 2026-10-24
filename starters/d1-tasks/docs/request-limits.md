# Task creation attempt budget

The optional public task creation limit is disabled by default. Deploy the complete
owner schema, then configure these Worker bindings (or local host environment):

```dotenv
D1_CREATE_LIMIT_ENABLED=true
D1_CREATE_LIMIT_REQUESTS=60
D1_CREATE_LIMIT_WINDOW_MS=60000
```

All POST /tasks attempts share one database-wide budget with fixed scope
public.tasks.create.v1 and subject application. This is a public single-tenant demo;
headers, forwarded IP, JSON or an idempotency key never select an identity. Body
size guards run first. Invalid JSON/schema, invalid request keys and replay attempts
count. Reads, activity, updates and deletes retain their existing behavior.

The store samples SQLite time within one atomic UPSERT and returns the committed
counter/deadline. Denial returns 429, Retry-After in whole seconds and no business,
activity or replay writes. A storage failure returns generic 503. An admitted
attempt is committed independently before business SQL and is not refunded on
later failure. Stable-key retry after replenishment still reads its original result.

Migration longhorn_batch_rate_limit/001_buckets appends after the previous complete
idempotency profile; all earlier IDs/statements remain unchanged. The app still
checks its complete trusted deployment history even when the capability is off.
It never migrates or repairs schema during HTTP startup. The local development
host deploys privately before serving; production deployment remains explicit.

Limits accept 1..1000000 requests and windows 1000..86400000 ms. All workers sharing
a live scope/subject must use the same policy. A changed live policy fails closed
until its window expires. Keep database time/persistence consistent across restore.

Expired rows reset when consumed. There is no timer or cleanup HTTP endpoint. A
trusted maintenance worker can call RateLimiter.prune(limit) with a
BatchSqliteRateLimitStore; the single native statement removes at most 1..10000
expired buckets across every scope. Close drains accepted work before the borrowed
D1 handle closes and never closes/deletes the platform binding.

See [features](features.md), [schema](schema.md), [idempotency](idempotency.md) and
[lifecycle](lifecycle.md). Physical cleanup and retained business data have separate
policies; removing a bucket never removes its task, activity or saved replay.
