# Hono request limit middleware

Owner: rateLimit in @longhornjs/ratelimit/hono. Connects an explicitly owned
[RateLimiter](request-limits.md) to Hono without opening storage or changing its lifetime.

```ts
import { rateLimit } from '@longhornjs/ratelimit/hono'
// Install the application's authentication middleware first.
app.post('/reports', requireAccount,
  rateLimit(limiter, c => c.get('auth').user.id), handler)
```

The trusted identity resolver can be asynchronous. Its errors propagate through
normal Hono error handling. The adapter invents no IP identity and trusts no
forwarded headers. Selecting/validating an identity and placing authentication,
origin/body checks before consumption belong to the application.

An allowed attempt awaits downstream middleware outside the storage-error catch.
Handler HTTPExceptions retain their normal status. A denied attempt returns 429,
Cache-Control: no-store, Retry-After rounded up to at least one delta second and
{error:'Too many requests. Try again later.'}. It never calls the handler. No raw
subject, SQL detail, policy state or remaining counter is exposed in the body.

Consumption failure returns 503, no-store and {error:'Request limit is unavailable'}.
An optional onError(error,context) observer is awaited before that reply. Its own
failure propagates through the application's error handler, so it also cannot
admit downstream work. Observers should log fixed codes, avoiding provider errors
and private identities. The command app logs only RateLimitError.code or 'store'.

This counts attempts, including admitted requests that later fail or replay a
response. Route/subject selection determines the budget; it is not automatic
application-wide protection. See [command wiring](command-request-limits.md),
[ownership](rate-limit-lifecycle.md) and [verification](rate-limit-testing.md).
