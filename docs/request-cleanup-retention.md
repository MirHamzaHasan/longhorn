# Replay expiry and physical record removal

Owner: existing Idempotency/IdempotencyStore policy. The
[cleanup worker](idempotency-cleanup.md) only schedules the existing
[bounded prune operation](idempotency-storage.md).

Replay expiry is logical even if its database row is still present. An expired
key can execute a new generation with the same or different input. Removing that
row does not shorten a live replay's configured retention or extend it. Default
request retention remains 24 hours, measured from callback completion with the
existing clock; replays do not refresh it. Cleanup creates no new time source.
Hosts sharing a ledger must use aligned clocks and a compatible expiry policy.

Pruning selects expires_at <= requests' current time across the whole store table.
One run removes at most its limit; there is no per-account/scope filter. In the
composed PostgreSQL app this includes public task, account command and saved-view
mutation replies. Opting in therefore applies to every namespace using that ledger.
Saved preferences themselves remain in their own table.

PostgreSQL's existing ordered selection uses FOR UPDATE SKIP LOCKED, preserving
rows held by active replay/replacement transactions. SQLite's native write
ownership serializes cleanup with producers. The native store tests remain the
authority for expiry races, rollback and process death; the worker changes no SQL.

Physical removal affects replay response rows only. Commands, tasks, jobs, outgoing
messages, receipts, accounts, saved views and recovery audit retain their existing
lifetimes. Backups taken earlier can still contain expired responses. This feature
does not reclaim all database file space, vacuum PostgreSQL or define erasure of
business records. Consumer effect deduplication has its own separate retention.

Do not rely on a request key for permanent uniqueness. Business constraints and
consumer deduplication enforce their own identities after request replay expires.
With cleanup disabled, rows persist until reused or explicitly pruned, while the
same logical expiry still applies. With multiple hosts, each has its own batch
budget; there is no cluster-wide rate leader or shared cleanup counter.
