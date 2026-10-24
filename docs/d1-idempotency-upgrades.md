# D1 request-ledger upgrade

Owner: the complete [schema.ts](../examples/d1-worker/src/schema.ts) manifest,
trusted deploy.ts and application startup. Connects [batch history](batch-migrations.md),
[records](batch-idempotency-storage.md) and [the host](d1-deployment.md).

Existing d1-tasks/001 and d1-tasks/002 SQL/checksums remain unchanged. The app
appends longhorn_batch_idempotency/001_requests, creating only its request table/
index. Existing tasks, UUIDs, revisions, positions and activity remain intact.
Include batchIdempotencyMigrations in the full ordered manifest; do not run a
second partial manifest against the same history tables.

Startup requires the complete history and reads expected ledger columns with
LIMIT 0. Old-schema requests return 503 and perform no schema writes. Trusted
deployment applies the missing suffix atomically. A later request recovers because
failed startup closes its handle and clears its cached failure. `pnpm dev:d1`
performs this private phase and removes the schema worker before readiness.

For retained data, keep the full persistence directory and use the owner-controlled
deployment process. The public app exposes no schema/maintenance route. A manifest
does not automate cloud deployment, replication/failover or mixed-version rollout.
Older code with a shorter expected history rejects the upgraded history; coordinate
versions through deployment. Scope versions separately protect input/result meaning;
schema history does not rename request scopes.

[Native proof](d1-idempotency-testing.md) creates the actual legacy two-migration
schema, writes a task/activity, confirms read-only new-app failure, invokes the
real private helper and proves only the ledger suffix applied before reading
the retained task/activity and exercising replay.
