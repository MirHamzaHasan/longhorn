# Native budget cleanup verification

Owners: [verify-limit-cleanup.mjs](../scripts/verify-limit-cleanup.mjs) and
[verify-prune-packages.mjs](../scripts/verify-prune-packages.mjs). Connects
[shared ownership](prune-worker.md), [budget API](rate-limit-cleanup.md),
[lifecycle](rate-limit-cleanup-lifecycle.md), [authority](rate-limit-cleanup-retention.md)
and the [runnable example](rate-limit-cleanup-example.md).

```sh
pnpm test:limit-cleanup
```

Build completes before compiled gates. All hosts, databases, gateways, subprocesses
and install directories are owned temporary resources. Proof JSON is written only
after all assertions pass: .artifacts/limit-cleanup-proof.json and
.artifacts/prune-package-proof.json. CI connects the native gate to account
operations and the packed gate to source/runtimes, retaining each artifact.

Actual Node 20.19.4, Bun 1.4.4 and Deno 2.9.6 execute the same exported cleanup API
over their native SQLite adapters. Three expired buckets across scopes are removed
in bounded batches while an exhausted live policy remains denied. A real held
native write keeps close pending until release. Cleanup leaves its borrowed limiter
and database usable; expired subjects replenish on next use.

A finite pinned workerd request exercises actual memory pruning and the portable
serial/recovery/reentrant-close/error-observer contract. It does not establish a
persistent Workers polling service. The pre-existing idempotency contract also
runs against the shared engine through its unchanged facade.

Native PostgreSQL uses the existing migration/store and a separate restricted
maintenance identity. The proof rejects SELECT/DELETE alone, then adds only the
required UPDATE(claim) lock permission. The HTTP runtime still cannot delete;
maintenance cannot update attempts or read business tables. A locked expired row
is skipped and then preserved after actual renewal. Revoked DELETE yields observed
errors; restoring it permits removal. An actual exclusive table lock is observed
through pg_blocking_pids before shutdown is required to wait for native settlement.

The shipped SQLite executable computes sum 12, counts validation failures and
retains exhausted quotas across processes. Disabled cleanup preserves three old
buckets; enabled cleanup removes them while preserving the exact live row. Invalid
settings fail before creating the data directory. A later startup failure verifies
cleanup closes before the owned database during rollback. SIGTERM shutdown exits
cleanly.

Actual pnpm archives for runtime/database/ratelimit/idempotency install independently
offline, then relocate and install with a frozen lock. Public exports/declarations
resolve without workspace aliases; both cleanup facades share PruneWorker and a
real expired memory bucket is removed. Unit tests retain prior idempotency behavior
and cover server-time dispatch, observer failure, bounds and snapshots. Existing
request-cleanup/native limiter gates remain regression checks.

This is finite local native evidence, not cloud failover. A separate [command application maintenance tool](command-limit-maintenance.md)
now has its own native/installed verification. SQL/migration definitions and runtime grants are unchanged.
