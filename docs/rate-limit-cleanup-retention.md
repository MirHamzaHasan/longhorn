# Budget cleanup retention and authority

Owner: existing `RateLimiter.prune`, not the timer. Connects [SQL providers](rate-limit-sql.md),
[memory](rate-limit-memory.md), [D1 batches](batch-rate-limits.md), [Redis](redis-rate-limits.md)
and [owned scheduling](rate-limit-cleanup.md).

Pruning is table/store-wide across scopes, bounded by the requested limit. It
removes expired buckets only. A live denied/exhausted bucket keeps its policy,
count and expiry. It never removes application results, commands, jobs, request
replay records or audit data. Once a bucket expires its next use could already
start a new budget without cleanup; maintenance reclaims unused expired state.

Managed memory/SQLite/PostgreSQL use the limiter's existing trusted clock. The D1
batch store samples native database time; Redis relies on its native TTL and prune
returns zero. No application clock override is introduced for server-timed stores.
Clock synchronization and live policy agreement remain host responsibilities.

SQLite performs a bounded atomic delete. PostgreSQL locks an ordered expired
prefix with FOR UPDATE SKIP LOCKED, so an actively renewed row can be skipped and
preserved after renewal. Separate cleanup owners can coexist under the provider's
native serialization, but their combined rate is a deployment choice.

PostgreSQL maintenance needs schema USAGE, table SELECT/DELETE, and UPDATE on at
least one column for the locking SELECT. This requirement follows PostgreSQL's
[SELECT locking privileges](https://www.postgresql.org/docs/18/sql-select.html).
The native proof uses a separate restricted maintenance role with UPDATE(claim),
which grants the lock permission without granting UPDATE on counts/expiry. It
first verifies SELECT/DELETE alone is rejected. Maintenance credentials remain
trusted: DELETE authority itself can remove live rows if used outside this API.

The existing account HTTP runtime still has bucket SELECT/INSERT/UPDATE and no
DELETE; its provisioning/role checks are unchanged. This feature neither grants
maintenance authority to it nor installs an account-host cleanup timer. Operators
can supply a separate maintenance limiter/connection in their own native owner.
There is no automatic grant repair, reset API, distributed leader or new migration.
