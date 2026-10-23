# Outbox retention and terminal cleanup

Owner: Outbox.prune and explicit SQL store maintenance. Connects [API](outbox.md),
[SQLite](outbox-sqlite.md), [PostgreSQL](outbox-postgres.md) and
[consumer IDs](outbox-consumer-deduplication.md).

```ts
const removed = await outgoing.prune({
  before: Date.now() - 7 * 86_400_000,
  limit: 100,
  includeFailed: false,
})
```

Retention defaults to keeping all records. No timer/deletion job is installed.
The caller supplies an inclusive updated_at deadline in nonnegative safe integer
milliseconds; limit defaults to 100 and allows 1–10,000. Successful rows are
eligible by default. includeFailed explicitly adds terminal failures. Pending and
running rows are always retained regardless of age. Validation precedes storage.

Each call affects only that Outbox's prefixed queue and deletes at most limit rows.
The partial terminal index supports time/ID selection. PostgreSQL skips locked
eligible records; SQLite serializes with a writer. The Outbox joins admitted prune
work at close. The database and maintenance credential remain host-owned.

Cleanup only removes outgoing status/payload records. It does not remove business
rows, request-idempotency results, broker messages or consumer receipts. A replayed
producer result can therefore still contain a JobInfo whose live get is missing
after pruning. Coordinate these retention policies for your application.

A failed row can represent an ambiguous remote acceptance as well as failure to
publish. Keep it for diagnosis until that uncertainty is handled. Deleting it does
not revoke a message already in the broker. Consumer deduplication records must
cover the application's possible delayed/duplicate delivery window; expiring them
permits a later duplicate to repeat its effect. The example keeps receipts without
automatic expiry. See [tests and limits](outbox-testing.md).

[Deliberate retry](outbox-deliberate-retry.md) does not recreate a pruned record.
If retry wins a race with cleanup, the pending state is retained; if cleanup wins,
retry reports missing. The [native concurrency proof](outbox-recovery-concurrency.md)
covers both outcomes without a new message ID or an orphan revision record.
