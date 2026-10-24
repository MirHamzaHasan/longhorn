# Expired request cleanup

Owner: src/request-cleanup.ts, operations.ts and operator-host.ts, using the local
@longhorn/idempotency/cleanup framework export. Connects [commands](commands.md),
[atomic writes](transactions.md), [named views](saved-views.md),
[lifecycle](lifecycle.md) and [deployment](deployment.md).

The default runtime profile leaves cleanup off. To enable it, edit the private
.operator.env file and restart the host:

```dotenv
REQUEST_CLEANUP_ENABLED=true
REQUEST_CLEANUP_INTERVAL_MS=60000
REQUEST_CLEANUP_LIMIT=100
```

Limits are 1–10,000 rows per batch and 1,000–86,400,000 ms between settled batches.
Defaults are 100 and 60,000. One batch runs at a time and full/error batches still
wait. Each host has its own budget. The owner stops timers and drains active SQL
before closing the pool. Failures log a fixed warning without request contents.

Only expired response rows in longhorn_idempotency.requests are removed, across
all request namespaces sharing that table. This includes the composed public task
API and account command/view mutations. Unexpired replays remain; commands, jobs,
receipts, saved preferences and recovery audit keep their existing lifetimes.
An expired request key can execute again whether or not its old row was removed.
Default logical request retention stays 24 hours; cleanup does not change it.

Enabled startup/readiness requires the existing ledger SELECT/DELETE grants. The
shipped runtime provisioner already supplies them. No new migration, extra grants,
browser control or HTTP cleanup endpoint is needed. Do not use an owner connection
in the host. Backups may still contain old replay records; this is physical ledger
maintenance rather than a business-data erasure policy.

The independent archive gate enables the actual host, restores retained state and
verifies expired removal alongside live replay, saved preferences and existing
command/account/export workflows.
