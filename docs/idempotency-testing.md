# Native idempotency verification

Owner: `scripts/verify-idempotency.mjs` and `scripts/fixtures/idempotency-*`.
Connects [API](idempotency.md), [serialization](idempotency-json.md),
[retention](idempotency-storage.md), [SQLite](idempotency-sqlite.md),
[PostgreSQL](idempotency-postgres.md), [Object SQL](idempotency-workers.md) and
[HTTP](idempotency-http.md).

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:idempotency
```

Source tests use workspace sources and real SQLite for business/job/request
commit/replay, contention, scopes, conflicts, rollback, caught publication failure,
historical response snapshots, clocks, result bounds, expiry replacement and
bounded cleanup. Pure serializer tests cover mutation-before-hash isolation,
strict/lossless JSON, UTF-8/depth limits, cycles, getters and key canonicalization.
Type contracts reject missing keys and non-JSON input/result types.

The native gate builds owned fixtures and proves:

| Engine/path | Evidence |
| --- | --- |
| SQLite file + separate processes | Independent readers see no uncommitted business/job/request; SIGKILL before commit permits execution; after commit replays; competing same-key producers return one pair |
| PostgreSQL restricted runtime | Same visibility/crash/contention proofs on a native server and multiple connections; conflict, rollback, expiry/reuse and pruning while an expired generation is held |
| HTTP across two compiled hosts | Ten normalized same-key requests produce one task/job; 409/400 paths, actual queue-permission rollback, successful same-key retry and original response after host restart |
| Object SQLite + actual native alarm | state.abort after alarm write rolls back request/business/job/wakeup and changes boot identity; reset after commit loses response but preserves replay; full host restart, expiry/cleanup and one consumed effect |

The PostgreSQL sandbox deploys the application's actual complete owner migrations
and restricted grants. Native SQL stores run with those runtime credentials; no
query-mocking path stands in for the ownership algorithm. SQLite and Object stores
use the production migrations/providers. Contended cleanup skips a held PG row;
SQLite cleanup waits for its writer and sees the renewed expiry.

The gate owns temporary paths, children, pools, Miniflare instances and its native
PostgreSQL cluster, and disposes them on success/failure. It does not access normal
example data or cloud accounts. Full PostgreSQL and transaction-publishing gates
protect existing task/report/account/queue/scheduler behavior; generated-project
checks protect archived packaging. A passing local native gate does not establish
cross-database/external-effect atomicity or managed-cloud routing/failover behavior.

[Cleanup verification](request-cleanup-testing.md) additionally exercises an optional
serial owner, native SQLite on all three hosts, restricted PostgreSQL grant recovery
and real blocked-query drain. Existing store ownership/expiry tests remain separate.
