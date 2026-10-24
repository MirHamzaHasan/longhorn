# Maintained report budgets

Run from the repository root:

```sh
export API_TOKEN="$(node -p "require('node:crypto').randomBytes(24).toString('hex')")"
LIMIT_CLEANUP_ENABLED=true pnpm dev:maintained-limits
```

POST /reports at 127.0.0.1:3029 accepts that bearer token and a numbers array.
[The full guide](../../docs/rate-limit-cleanup-example.md) includes a curl request,
configuration and lifecycle. Quota survives restart; enabled cleanup reclaims only
expired buckets, in serial bounded batches. It is off by default. Use the same
configured subject to preserve the budget when rotating the token.

Each connection has a guide: [API](../../docs/rate-limit-cleanup.md),
[shared owner](../../docs/prune-worker.md), [retention/authority](../../docs/rate-limit-cleanup-retention.md),
[shutdown](../../docs/rate-limit-cleanup-lifecycle.md) and [native/packed proof](../../docs/rate-limit-cleanup-testing.md).
Run `pnpm test:limit-cleanup` for the complete verification gate.
