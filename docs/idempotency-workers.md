# Object SQL idempotent producers

Owner: SqliteIdempotencyStore with `@longhorn/workers/durable-sqlite`. Connects
[Object transactions](durable-sqlite-transactions.md), [managed publishing](object-transaction-publishing.md),
[alarm projection](alarm-wakeup-planning.md) and [record retention](idempotency-storage.md).

Use the same SQLite idempotency migrations and store inside one SQLite-backed
Durable Object. Its application's complete history owns those migrations. The
store borrows that Object's Database; the queue and optional alarm clock must use
the same Database/native storage pair. No Node API or connection pool is imported
by shared idempotency code; JSON hashing uses Web Crypto.

The provider serializes admitted SQL work and keeps the native input/storage gate
through the async transaction callback. The request UPSERT, business writes, job
insert and saved JSON result participate in that transaction. Managed publishers
drain before the optional alarm commit hook projects the earliest job wakeup. A
native interruption after the alarm write rolls all four resources back together.
Native rollback releases ownership; a new Object instance can execute the retry.

After a successful commit, an Object reset before HTTP delivery leaves the saved
result intact. Same scope/key/input replays that original result with no new job.
The alarm can independently reconstruct a consumer, read the committed business
row and complete the existing job. A replay still returns its historical producer
snapshot, even after the current job succeeds.

Scope/key uniqueness is local to the Object's SQL database. Use stable Object
routing for an operation; sending the same key to different Object IDs does not
provide cross-Object deduplication. Principal-derived scopes still matter within a
shared Object. Use prune in bounded owned work; it does not take over native alarm
ownership or automatically schedule cleanup. Clock/retention rules match the other
SQL stores.

[Native QA](idempotency-testing.md) runs real workerd with persistent SQL storage,
checks changed boot identities after state.abort, disposes/restarts the host,
replays a deliberately lost response, exercises expiry/cleanup and waits for an
actual native alarm to produce one effect. Managed-cloud failover/deployment and
cross-Object coordination remain outside that local proof.
