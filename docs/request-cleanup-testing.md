# Native expired-request cleanup proof

Owner: cleanup.test.ts, scripts/fixtures/cleanup-*.mjs,
scripts/verify-request-cleanup.mjs and the independent command archive gate.
Connects [worker](idempotency-cleanup.md), [lifecycle](idempotency-cleanup-lifecycle.md),
[host](request-cleanup-host.md) and [existing store proof](idempotency-testing.md).

```sh
pnpm test
pnpm test:request-cleanup
pnpm test:idempotency
pnpm test:command-app
```

Ten source cases use controlled timers and held promises to verify defaults,
copied options, serial full/empty/error batches, no catch-up, pre-start close,
active drain, synchronous reentrant close, async observer ownership/failure,
invalid provider counts/bounds and detached private counters. Host config cases
cover default-off selection, explicit values and rejected bounds.

The native gate executes the pure coordination fixture in actual pinned Node, Bun,
Deno and workerd. The pruner in that fixture is explicitly a coordination probe.
Node, Bun and Deno additionally use their real SQLite adapters and migrations to
delete an expired row, preserve a live reply and permit expired-key reexecution.
Deno grants cover only owned data and imported adapter/database files. workerd
owns one finite fetch invocation; it proves no persistent timer/deployment claim.
A separate Node SQLite case removes three rows in bounded two-row batches.

Real restricted-role PostgreSQL/HTTP proves disabled hosts create no worker,
enabled startup rejects missing ledger grants, command and view replay namespaces
are pruned in bounded batches, and live replies/business jobs/views/audit remain.
Runtime DELETE withdrawal is observed/retried and makes readiness fail; restoring
the grant recovers. A held replacement survives repeated pruning. A real table
lock blocks a prune while app.close waits, proving cleanup settles before pool
release. Owned resources/temp databases are released by the gate.

Ignored .artifacts/request-cleanup-proof.json records runtime/store outcomes and
aggregate snapshots. The account-operations CI job runs this native gate. Existing
SQLite/PostgreSQL/workerd idempotency crash/expiry tests remain unchanged and are
rerun as provider regressions.

The relocated/frozen-installed command archive ships the new subpath, host helper
and its own guide. Its private runtime profile explicitly enables cleanup. After
offline restore, real expired ledger entries disappear while the original live
command replay, command count and named view remain. Existing account, receipt,
export and browser workflows continue in that restored artifact. No screen or new
visual behavior is introduced by this backend feature.
