# Redis request limit verification

Owner: scripts/verify-redis-limits.mjs. Run pnpm test:redis-limits after frozen
installation. A native redis-server executable must be available; optional
LONGHORN_REDIS_SERVER selects its explicit path. CI uses its Redis job and retains
.artifacts/redis-rate-limit-proof.json. No existing Redis service is modified.

Node, pinned Bun/Deno and a finite real workerd invocation execute the built shared
command/Hono boundary with an explicit fake command client. They prove imports,
server-observed waits, private hashed keys, 429, native-TTL prune behavior and
reentrant drain. These are protocol tests, not claims of native Redis TCP adapters
for those other runtimes. Actual Redis Lua/TCP ownership uses Node separately.

Two native clients execute 80 competing reservations and admit exactly seven,
without extending the deadline. Other namespace/scope/subject budgets remain
independent. A real CLIENT PAUSE queues a reservation; observedAt/expiry begin after
server queueing. Native TTL removes a short window, then accepts a new policy.
Live policy mismatch preserves the original value/deadline. Malformed state,
missing/mismatched expiry and non-string keys fail without resetting stored data.

A namespace ACL permits runtime EVAL/read/write/time but denies DEL/SCAN/foreign
keys. Removing SET makes consumption fail without changing the bucket. An owned
Redis AOF process is SIGKILLed after commitment; a fresh native server/connection
retains the window and denies another attempt. This proves only that tested local
persistence configuration, not general replication/failover behavior.

Two actual example hosts share a bearer-mapped stable subject. Unauthorized and
oversized requests do not consume; malformed JSON does. A real computed report
uses the remaining attempt, then returns 429 with no result. Forged forwarded IP
and host/token rotation cannot refill the window. Native expiry replenishes it.
Server outage produces readiness/storage 503 while liveness stays available;
explicit server/host restart recovers the connection.

A TCP proxy forwards a reservation to actual Redis and withholds its committed
reply. Native HTTP shutdown remains pending through the command deadline, returns
private 503 and closes its borrowed connection after admitted work. The retained
counter proves one original attempt; explicit retry adds one and is denied.
Finite source tests additionally validate malformed server time/replies, bounds,
capacity, custom-provider compatibility and startup rollback. Existing SQL/native
limiter gates are rerun to verify their application-clock contract is preserved.
