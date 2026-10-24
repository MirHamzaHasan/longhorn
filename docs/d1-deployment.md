# D1 deployment and startup ownership

Owner: [deploy.ts](../examples/d1-worker/src/deploy.ts),
[the development host](../scripts/serve-d1-worker.mjs) and application startup.
Connects [batch migrations](batch-migrations.md) to [D1 tasks](d1-tasks.md),
configuration, DI and lifecycle without a public migration route.

`pnpm dev:d1` builds the example/dependencies and starts local workerd at
127.0.0.1:3016. HOST/PORT use the runtime's validated listener settings; PORT=0
chooses an available port. D1_MAX_PENDING defaults to 6 and accepts 1–64. Invalid
configuration fails before creating retained storage. D1_DATA_PATH selects a
directory, defaulting to examples/d1-worker/data/d1 (gitignored).
D1_REQUEST_RETENTION_MS defaults to 86400000 (1–2592000000), supplying the
[request replay](d1-idempotency-http.md) deadline policy. The host forwards its
validated value as a binding, without adding a public maintenance route.

The host loads the same compiled config schema as the Worker. Two initial workers
share a retained D1 database: the public app and a private schema worker. The host
invokes the schema worker through Miniflare's internal service API, then removes
that worker while retaining all host/storage/compatibility options. A successful
application health request precedes the HTTP listening announcement. Each worker
explicitly pins compatibility date 2025-07-18. SIGINT/SIGTERM await owned runtime
disposal, including interruption during startup.

The public app never routes to the schema worker. Application startup only checks
history and expected columns, registers its database token and returns close as
cleanup. Concurrent requests share startup per binding identity. Failed startup
closes that handle and clears the failed cache entry, allowing a later request
to recover after trusted deployment. Readiness reports the successful startup
check; /health is not a fresh database probe on every request.
The [ledger upgrade](d1-idempotency-upgrades.md) appends schema after the existing
task/activity migrations and participates in this same read-only startup check.

The [Wrangler example](../examples/d1-worker/wrangler.example.toml) names only
dist/index.js and an explicit DB binding placeholder. Creating cloud resources,
providing real IDs and invoking deploy.ts through an owner-controlled private
deployment workflow remain application-owned. The schema worker is a helper with
deployment authority, not an authenticated HTTP administration service. Do not
publish it as the app entrypoint. This checkout supplies a working local deployment
path; it does not automate or claim a verified remote Wrangler release.

Worker eviction does not guarantee lifecycle cleanup. Await database work inside
the request; do not assume arbitrary background work or a platform final close
hook. The provider's explicit close/drain behavior and retained local host restart
are tested separately in [native verification](d1-testing.md).
