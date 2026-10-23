# Idempotency records, ownership and retention

Owner: IdempotencyStore and the built-in SQL stores. Connects [request API](idempotency.md),
[SQLite schema](idempotency-sqlite.md), [PostgreSQL schema](idempotency-postgres.md)
and [migrations](migrations.md).

SQLite uses longhorn_idempotency_requests; PostgreSQL uses
longhorn_idempotency.requests. Their composite primary key is (scope,request_key).
Records store a SHA-256 fingerprint, opaque execution-generation claim, result JSON
text and an expiry in safe epoch milliseconds. An expiry index ordered by
expires_at/scope/request_key supports bounded cleanup. A check requires result and
expiry to be both absent or both present. The absent form exists only inside a
native transaction; built-in stores never commit it.

One UPSERT inserts a fresh claim or performs a no-op request_key update on the
existing row, returning its metadata. This takes native row/write ownership before
examining fingerprint/expiry. A different committed claim must have a saved result.
Unexpired rows replay or conflict; missing/expired generations run the callback
and update result/fingerprint/claim/expiry in that same transaction. Concurrent
replayers and replacements cannot independently own one key. Replays acquire a
write lock and PostgreSQL can create a new row version even though the key value
does not change; this is an explicit contention/write-amplification tradeoff.

The expiry is computed at callback completion, immediately before result storage,
as clock() + retentionMs. It is not extended on replay. The native commit and any
joined publishers/provider commit hooks may finish later. Expired means
expires_at <= clock() evaluated after ownership is acquired. Clocks must return
nonnegative safe integer milliseconds; unsafe expiry fails the transaction. Hosts
sharing a database need aligned clocks. No application clock can make a globally
strict retention interval under arbitrary clock skew.

```ts
const removed = await requests.prune(100) // default 100; allowed 1–10,000
```

prune deletes at most limit expired records with one native statement and returns
the affected count. It creates no timer; a host may schedule bounded calls through
its existing lifecycle. PostgreSQL selects with FOR UPDATE SKIP LOCKED, so active
producers/replayers are skipped. SQLite serializes its delete with write owners.
Deletion does not change business rows/jobs. Retention governs replay eligibility,
not automatic deletion: without pruning, keys remain stored until reused/deleted.
After expiry/cleanup, the key can execute again, even with changed input.

Custom IdempotencyStore implementations receive normalized scope/key/fingerprint,
retention and clock plus a callback returning bounded JSON text. They must implement
the same atomic ownership/replay/expiry/rollback contract, supply a managed executor
if using transaction publishing, and keep request output invisible until the outer
commit. The raw store contract trusts normalized inputs; applications should use
Idempotency. Stores do not own database migrations or shutdown.
See [native ownership/cleanup proofs](idempotency-testing.md).
