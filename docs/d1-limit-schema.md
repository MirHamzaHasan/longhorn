# D1 budget schema and deployment

Owners: batchRateLimitMigrations and the existing complete task deployment profile.
Connects [provider](batch-rate-limits.md), [migrations](batch-migrations.md),
[task API](d1-request-limits.md) and [proof](d1-limit-testing.md).

Migration longhorn_batch_rate_limit/001_buckets creates the STRICT table
longhorn_batch_rate_limit_buckets. It appends after the complete task/activity/
batch-idempotency prefix. Earlier migration IDs, SQL and checksums stay unchanged.
The batch bucket schema is distinct from managed callback SQLite/PostgreSQL stores.
Never deploy the callback schema in its place or rewrite an already applied ID.

The primary key is (scope,subject_hash). Native checks constrain scope/hash length,
lowercase hex hash, policy/window bounds, count 1..limit+1, safe integer observation/
expiry and expiry>observedAt. Every committed row is complete. An expiry/scope/hash
index supports deterministic bounded maintenance across scopes. No new user data,
credentials, business record, activity or replay schema is introduced.

The existing migration runner guards the exact observed history and commits the
whole missing suffix in a native batch. D1 documents native batch rollback on
statement failure; see [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
A stale competing deployment can fail; explicitly rerun it to observe the now-complete
history. Native tests force a failing suffix and race two deployment workers,
preserving the previous task and exact history prefix.

Public app startup still verifies the complete trusted manifest and required task/
request columns. An enabled limit also probes bucket columns. Even disabled new
code requires the appended complete profile; it does not weaken schema history
verification. The local/generated host deploys through its private schema worker,
removes that authority, then reports readiness. Production deployment remains an
explicit trusted workflow. /deploy is never a public application route.

D1 bindings are trusted database authority and are not separate SQL runtime roles.
The request store uses the borrowed handle without provisioning. Maintenance calls
prune explicitly and removes only expired buckets, never associated task/activity/
replay effects. Database restore must retain counters, migration history and the
other data together. Native local restart is verified; cloud replication/failover,
remote backup/restore and platform durability guarantees are not inferred from it.
