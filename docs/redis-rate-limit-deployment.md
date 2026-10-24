# Redis budget authority and retained state

Owners: Redis deployment and the host's existing [Node connection](redis-node.md).
Connects [provider](redis-rate-limits.md), [API example](redis-rate-limit-example.md)
and [verification](redis-rate-limit-testing.md).

Use a dedicated trusted Redis 7+ standalone endpoint with maxmemory-policy
[noeviction](https://redis.io/docs/latest/develop/reference/eviction/). Eviction/deletion of a live key starts a fresh budget and breaks the
intended limit. Namespace separation does not protect state from administrative
FLUSH, eviction, credential compromise or other writers with matching key access.
Choose memory capacity and monitor rejected writes; noeviction exhaustion fails
storage calls closed instead of intentionally removing another live budget.
The package does not read/change CONFIG or enforce a remote global entry count.

Use verified rediss TLS and Redis authentication. The optional Node adapter permits
plain redis only with explicit insecure-loopback opt-in. Private CA configuration
keeps verification enabled. Neither shared provider nor example logs URLs, token
material, raw identities, Lua response data or native error text.

A runtime ACL can restrict keys to longhorn:ratelimit:v1:<namespace>:* and allow
AUTH, SELECT (if needed), PING (example readiness), EVAL, TIME, GET, SET and
PEXPIRETIME. Lua command access is still checked by Redis. Runtime needs no DEL,
UNLINK, SCAN, KEYS, CONFIG or FLUSH. SET is trusted write authority: a holder can
alter an allowed bucket directly, so it is not a defense against compromised
runtime credentials. Keep cache and limiter namespaces/ownership separate; a cache
store owns its connection, while a rate-limit store borrows it.

Choose persistence to match the required retained budget. The native gate runs an
owned AOF server with appendfsync always, kills it and verifies the live counter/
deadline after restart. That is finite local evidence for the tested configuration,
not a promise about an arbitrary managed Redis deployment or replication/failover.
The command app's PostgreSQL checkpoint does not include external Redis state; the
new protected example has no SQL/checkpoint integration. Redis backup/restore and
clock consistency belong to its deployment.

A token rotation with a stable namespace/scope/subject retains the budget. Changing
any of those labels intentionally creates another key. Keep limit/window consistent
across hosts during a live window; conflicting policy fails closed until expiry.
Deploy migrations for other modules separately: this provider needs no SQL schema.
