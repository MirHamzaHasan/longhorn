# Independent audit retention

Owner: Outbox.pruneAudit and trusted maintenance credentials. Connects
[history](outbox-audit-history.md), [schema/roles](outbox-audit-storage.md),
[delivery cleanup](outbox-retention.md) and [native proof](outbox-audit-testing.md).

```ts
const removed = await outgoing.pruneAudit({
  before: Date.now() - 90 * 86_400_000,
  limit: 100,
})
```

History is retained by default; no expiry timer or automatic delete job is created.
before is an inclusive service-createdAt deadline in safe nonnegative milliseconds.
Limit defaults to 100 and permits 1–10,000. One native DELETE removes at most that
many eligible records for this exact Outbox and returns the count. Concurrent
deletions can affect fewer rows; database lock/connection failures propagate.
Admitted maintenance work is joined before Outbox close.

Audit rows are independent of job/request/receipt rows. Delivery pruning does not
remove audit records, and audit pruning does not change delivery state, request
replays, broker messages or consumer deduplication. Missing-target actions can add
history after delivery removal. This independence lets the application choose
different history and message retention periods.

The PostgreSQL retention statement requires table SELECT/DELETE and schema USAGE;
it does not need audit UPDATE or access to queue rows. See the documented
[DELETE privileges](https://www.postgresql.org/docs/18/sql-delete.html). Normal
audited runtime credentials deliberately have only SELECT/INSERT on the audit
table. The Worker demo exposes no HTTP audit-delete endpoint; maintenance is an
explicit host/library responsibility.

Retention removes evidence intentionally and is an application policy, not an
automatic promise to keep every event forever. The native gate proves bounded
deletion under a dedicated minimal PostgreSQL maintenance role and actual Object
storage, while Source SQLite tests prove queue isolation and history outliving jobs.
