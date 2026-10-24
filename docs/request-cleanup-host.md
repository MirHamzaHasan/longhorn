# Operator host request cleanup

Owner: examples/postgres/src/operator-config.ts, operator-host.ts,
operations.ts and request-cleanup.ts. Connects [framework worker](idempotency-cleanup.md),
[retention](request-cleanup-retention.md), [host configuration](operator-host-configuration.md),
[runtime roles](postgres-roles.md) and [standalone distribution](command-app-distribution.md).

The feature is off by default. Opt in through the existing runtime configuration:

```dotenv
REQUEST_CLEANUP_ENABLED=true
REQUEST_CLEANUP_INTERVAL_MS=60000
REQUEST_CLEANUP_LIMIT=100
```

ENABLED accepts true/false. LIMIT is an integer 1–10,000, default 100. INTERVAL_MS
is an integer 1,000–86,400,000, default 60,000. The schema validates supplied values
even while disabled. Environment/file precedence follows the existing host loader.
Restart the owned host to apply configuration; no browser control or cleanup HTTP
endpoint is added.

Programmatic createPostgresApp({operations:{requestCleanup:{limit,intervalMs,onError}}})
uses the package bounds. Leaving requestCleanup absent registers no cleanup provider
or timer. When present, operations registers PgRequestCleanup against its existing
Idempotency provider, copies options, starts it through app.onStart and returns its
close function. Embedded hosts can resolve the token for its private aggregate
snapshot. The native host logs requestCleanupEnabled at listening and uses a fixed,
data-free operational warning on failures.

Enabled startup and /readyz verify the existing ledger shape plus effective table
SELECT/DELETE privileges. Those grants are already part of the runtime profile.
Missing privileges reject startup; later withdrawal produces failed runs and 503
readiness, while other admitted API reads retain their own behavior. Restoring
grants lets cleanup/readiness recover. No schema, index, migration, new authority
or automatic grant repair is introduced. Startup access checks do not prune.

The worker applies table-wide, including other request namespaces sharing the
database. Review the [expiry contract](request-cleanup-retention.md) before enabling
it. Each host owns its own interval/limit; deployment decides how many hosts enable
the feature. Shutdown drains any admitted prune before closing its borrowed pool.
