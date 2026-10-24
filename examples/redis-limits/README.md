# Shared Redis request budgets

A small protected report API demonstrates the portable limiter, owned Node Redis
connection, DI, validation and lifecycle. Redis 7+ owns its window clock and expiry;
multiple API processes use the same budget. The command application continues to
use its existing PostgreSQL policy.

From the repository root, install dependencies and copy this directory's
.env.example to .env. Set a private API_TOKEN, Redis credentials and a stable
RATE_LIMIT_SUBJECT/REDIS_NAMESPACE. Configure a dedicated noeviction Redis deployment
with the persistence/durability policy you require. Use verified rediss transport
in production; insecure redis is explicitly restricted to local loopback.

```sh
pnpm install --frozen-lockfile
pnpm dev:redis-limits
```

Submit a report using your configured token:

```sh
curl http://127.0.0.1:3028/reports \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"numbers":[3,7]}'
```

The real result is {result:{count:2,sum:10}}. Authenticated attempts share the
configured budget, including invalid report bodies. Denial returns 429 and
Retry-After; a storage error returns private 503. GET /livez and /readyz report
process/Redis connectivity separately. They do not consume a quota or check every
mutation permission. A failed connection requires an explicit host restart.

The capability token maps to the configured server-side subject. No forwarded IP,
header, query or JSON value selects a budget. Rotating the token with the same
namespace/scope/subject retains the current window. This example is a service
capability API; it does not represent individual people or create user accounts.

See [provider](../../docs/redis-rate-limits.md),
[setup and flow](../../docs/redis-rate-limit-example.md),
[ACL/durability](../../docs/redis-rate-limit-deployment.md),
[ownership](../../docs/redis-rate-limit-lifecycle.md) and
[native verification](../../docs/redis-rate-limit-testing.md).
