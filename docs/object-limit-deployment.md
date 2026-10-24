# Object report budget schema deployment

Owner: `createReportApp` in [app.ts](../examples/durable-worker/src/app.ts).
Connects [Object migration history](durable-sqlite-migrations.md), the
[alarm schema](alarm-migrations.md) and [optional report budgets](object-report-limits.md).

The bucket schema is the unchanged managed SQLite `rateLimitMigrations`, ID
`longhorn_rate_limit/001_buckets`, table `longhorn_rate_limit_buckets`. There is no
new table variant, migration ID or provider schema. The app composes:

```text
scheduled profile: complete original report migrations -> rateLimitMigrations
alarm profile: complete original report + alarm migrations -> rateLimitMigrations
```

Append after the complete selected profile in `createReportApp`; do not insert the
bucket migration into the shared report manifest before an already deployed alarm
migration. Existing migration IDs, order and checksums remain unchanged. The
migration runner checks the full prefix and commits DDL/history atomically. A
failed suffix leaves the previous schema/history/effects intact and can be retried.
Native verification starts both actual old profiles before upgrading them.

Each Object owns migration at app startup, as in the existing example. The profile
is complete even with REPORT_LIMIT_ENABLED=false; disabling the provider does not
roll back schema, erase budgets or remove business data. New code must retain the
appended manifest when toggling settings. Older binaries whose manifest lacks the
new suffix are not promised to accept newer history; keep code/profile versions
consistent rather than deleting migration records to downgrade.

This SQL addition does not rename the Object class, namespace or fixed owner name.
The existing Wrangler class migration remains separate from per-Object SQL history;
no additional class migration is required solely for this table. The scheduled and
alarm examples remain separate deployments/namespaces. No public SQL deployment,
inspection, reset, prune or private tick route is exposed.

Local hosts retain storage across processes. Validate configuration before creating
the host; deploy consistent limits/window values for one shared live scope. A live
policy mismatch fails closed and preserves the bucket until expiry. See
[store semantics](object-request-limits.md), [lifecycle](object-limit-lifecycle.md)
and [native upgrade proof](object-limit-testing.md).
