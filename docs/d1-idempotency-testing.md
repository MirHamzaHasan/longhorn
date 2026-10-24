# Native D1 request replay verification

Owner: [verify-d1-idempotency.mjs](../scripts/verify-d1-idempotency.mjs),
[its private fixture](../scripts/fixtures/d1-idempotency.mjs) and the existing
[D1 gate](d1-testing.md). Connects [plans](batch-idempotency.md),
[retention](batch-idempotency-storage.md), [HTTP](d1-idempotency-http.md) and
[upgrade](d1-idempotency-upgrades.md).

```sh
pnpm test:d1-idempotency
pnpm test:d1
```

Built browser modules run on actual local D1/workerd 1.20250718.0 through Miniflare
3.20250718.3. Each worker pins compatibility date 2025-07-18. The gate owns temporary
retained databases, Worker applications and one loopback HTTP gateway, without
cloud credentials/shared user data. Local evidence is macOS ARM64 / Node 20.19.4.

Native checks prove pre-hash snapshots, canonical JSON replay, original expiry,
scope isolation, input conflicts, business/ledger rollback and deliberate retry.
A binding commits then loses its acknowledgement; another batch commits then
fails precision decoding. Both recover from the ledger without repeating SQL.
Failed expiry replacement restores the old record; concurrent replacements have
one winner. Bounded cleanup preserves live records and business effects.

The application upgrades the legacy schema without losing tasks/activity. Six
concurrent requests through two Worker applications return one new response and
five identical replays with one task/activity. HTTP covers invalid keys, normalized
titles, original responses after edits, activity-trigger rollback, retry, ordinary
unkeyed creation and actual configured expiry.

The gateway receives a committed 201 from the actual workerd HTTP listener, then
destroys the client socket before forwarding it. The client sees failure; retry
gets the exact saved body/Location with one activity. A new workerd process replays
that response from the retained directory. Deleting then replaying returns the
original snapshot without recreating the task; activity remains readable.

The expanded base D1 gate proves numeric ordering through positions 9/10 and
beyond 2^53. Qualified integer ORDER BY avoids lexical sorting of the CAST text
projection. Unit/types cover plan/JSON/byte limits, expiry, sanitized failures,
malformed records and callback rejection. Source tests pass 497 tests in 84 files;
workspace build/types and existing SQLite/PostgreSQL/Object idempotency gates pass.

Hosted d1-storage runs both D1 scripts. Prior revisions were blocked by the Actions
budget before allocation; current PR checks remain the hosted authority. Local QA
does not prove cloud failover, arbitrary platform-final cleanup, production
throughput or retention under unsynchronized clocks.
