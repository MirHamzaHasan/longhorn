# Native outgoing recovery verification

Owner: `scripts/verify-outbox-recovery.mjs`, recovery process/Worker fixtures and
`examples/jobs/src/outbox-recovery.test.ts`. Connects [inspection](outbox-inspection.md),
[retry](outbox-deliberate-retry.md), [native ownership](outbox-recovery-concurrency.md),
[upgrade](outbox-recovery-migrations.md) and [HTTP](outbox-operations-http.md).

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:outbox-recovery
```

Source tests use real SQLite and workspace sources for tied keyset pages,
queue/filter context, explicit metadata fields, competing requests, immutable
envelopes, delayed eligibility, cumulative attempts, stale revisions at the same
clock time, lifetime cap, ineligible/missing/pruned states and actual lease fencing.
Accepted inspection/retry work drains before Outbox close. Type contracts require
the observed ceiling and a valid durable-state filter.

Native SQLite and PostgreSQL producers use production stores/providers. A test-only
native transaction wrapper pauses the conditional UPDATE before commit so an
independent observer can verify old state; SIGKILL rolls it back. A kill after the
normal committed retry preserves its pending state/budget. Separate operator
processes contend on one record and only one schedules it. Another race pits retry
against maintenance pruning and accepts only a retained pending row or deletion/
missing outcome. Metadata pages and actual index-history upgrades are checked.

An accepted real workerd broker send is deliberately reported as failure; manual
retry sends the same application ID. Distinct broker delivery IDs produce one SQL
effect. The restricted PostgreSQL runtime uses only its existing queue DML; a
separate maintenance connection exercises deletion.

The Object fixture seeds the prior complete command history and a failed outgoing
record after actual broker acceptance, then starts the compiled upgraded app. The
new index appends and data survives. Native HTTP checks disabled/unauthorized/
authorized paths, strict validation, budget conflict, live opaque cursor pages and
response fields. Actual state.abort after retry's alarm write rolls state/ceiling/
wakeup back and changes boot identity. Competing authorized requests grant one
budget; an automatic native alarm publishes the original ID and the consumer keeps
one receipt. Another host restart preserves results with operations disabled.
The local launcher also proves opt-in binding authorization over TCP, secret-free
output and signal disposal.

All fixture storage, processes, pools, Miniflare hosts and the native PostgreSQL
cluster are owned and disposed on success/failure. No normal example data or cloud
account is used. The prior outbox and generated-project gates protect old producers,
dispatchers, alarm/reset paths and archived package exports. A passing local test
does not provide cross-system atomicity or per-user operator audit/authorization.
