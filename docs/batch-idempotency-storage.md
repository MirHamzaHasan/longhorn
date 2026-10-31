# Batch request records and retention

Owner: `batchIdempotencyMigrations` and `BatchIdempotency` from
`@longhornjs/idempotency/batch-sqlite`. Connects [plans](batch-idempotency.md),
[schema history](batch-migrations.md) and [D1 upgrades](d1-idempotency-upgrades.md).

The separate STRICT table longhorn_batch_idempotency_requests has a composite
(scope,request_key) primary key, SHA-256 fingerprint, unique execution claim,
complete result JSON and safe epoch-millisecond expiry. No pending record is
committed. An expiry/scope/key index supports bounded maintenance. This schema
is independent of the callback SQLite/PostgreSQL ledgers.

Each attempt samples the application clock after hashing, immediately before SQL.
Expiry is that admission time plus retentionMs, checked for safe-integer overflow.
This batch API uses admission time; the callback service samples completion time.
Replay does not extend expiry. expires_at <= the attempt's sampled time permits
replacement. Shared hosts need aligned nonnegative safe-integer clocks. An operation
that outlasts retention can overlap a new generation; retention is not an unbounded
exactly-once guarantee.

One native batch deletes only an expired matching key, inserts its replacement,
then runs business SQL. The unique key admits one winner. A later SQL failure
restores the old record and business state through rollback. After an ambiguous
failure the service reads committed evidence without automatically retrying writes.
Failure to read a record cannot establish that no write committed.

```ts
const deleted = await requests.prune(100)
```

Cleanup defaults to 100 records (allowed 1–10000). One native DELETE selects expired
keys in expiry/scope/key order with LIMIT. It preserves live request records,
business rows and task activity. There is no timer or public maintenance route.
Expiry governs replay eligibility; without pruning, records remain until replaced
or explicitly removed. After expiry/cleanup, a key can execute again with new input.

JSON is validated before execution. SQL also requires valid JSON capped at 1 MiB.
Recovery validates stored shape, safe expiry and bounded JSON again; malformed
records fail with code record. Ledger authority remains trusted, and read consistency/
provider result limits still apply. Native local D1 tests use actual database
bindings. See [rollback, races and pruning](d1-idempotency-testing.md).
