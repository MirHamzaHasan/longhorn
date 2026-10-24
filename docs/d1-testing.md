# Native D1 verification

Owner: [verify-d1.mjs](../scripts/verify-d1.mjs), its
[private fixture](../scripts/fixtures/d1-storage.mjs) and
[the development host](../scripts/serve-d1-worker.mjs). Connects the
[provider](workers-d1.md), [schema runner](batch-migrations.md),
[deployment boundary](d1-deployment.md) and [task API](d1-tasks.md).

```sh
pnpm test:d1
```

Built browser bundles run on actual workerd 1.20250718.0 through pinned Miniflare
3.20250718.3, with each worker explicitly using compatibility date 2025-07-18.
The gate owns temporary D1 persistence, workers and child processes; it uses no
cloud credentials or shared application data. The local evidence is macOS ARM64
with Node 20.19.4. The configured Ubuntu d1-storage job is a separate hosted gate.
The complete source suite passes 491 tests in 83 files; workspace types, existing
Durable Object SQL, native runtime and independent generated-starter gates pass too.

Provider checks exercise native values/blob snapshots, metadata, atomic batch
constraint rollback, unsafe integer rejection, exact int64 text, trigger bodies,
input admission and close while an actual committed binding result is held.
An unsafe RETURNING result deliberately fails decoding after commit, proving
that a rejected promise cannot establish non-delivery.

Schema checks prove DDL and history roll back together, immutable checksums,
two stale concurrent plans with one winner, explicit idempotent rerun and
read-only verification. Before trusted deployment, the real app returns 503
without creating history. After the private helper runs, a new request recovers.

Two Worker applications share actual D1 storage. HTTP tests cover validated
CRUD, malformed JSON/cursors, body limits, exactly one successful concurrent
revision edit, stale delete, atomic task rollback after activity failure and
bounded pages with actual positions beyond 2^53. A new workerd process with the
same retained directory preserves tasks/activity/native rows and has a new
isolate identity. The private raw-SQL fixture is never bundled into the app.

The actual local host additionally proves retained HTTP writes across restart,
removal of the schema worker before readiness, invalid configuration before
directory creation and signal cleanup during startup. Unit/type checks cover
whole-input preflight, scalar failures, count/byte limits, SQL boundaries,
sanitized errors, manifest snapshots and native binding/session compatibility.

This is real local D1 binding evidence. It does not establish managed cloud
replication/failover, production throughput, a timed-out query rollback, crash
recovery during an in-flight cloud request or arbitrary platform final cleanup.
Hosted checks and [the support matrix](supported-runtimes.md) record their own
revision-specific availability; configured jobs are not execution evidence.
