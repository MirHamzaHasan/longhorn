# Redis request attempt limits

Owner: RedisRateLimitStore in @longhornjs/ratelimit/redis. Connects the existing
[RateLimiter](request-limits.md), [server clock contract](rate-limit-server-clock.md),
[Node connection](redis-node.md), [Hono](rate-limit-http.md) and
[working API](redis-rate-limit-example.md). It imports no native/network module.

```ts
import { RateLimiter } from '@longhornjs/ratelimit'
import { RedisRateLimitStore } from '@longhornjs/ratelimit/redis'
import { openRedis } from '@longhornjs/node/redis'
const client = await openRedis({ url: redisUrl })
try {
  const limiter = new RateLimiter({
    scope: 'reports.submit.v1', limit: 60, windowMs: 60_000,
    store: new RedisRateLimitStore(client, { namespace: 'reports' }),
  })
  try { await limiter.consume('trusted-principal') }
  finally { await limiter.close() }
} finally { await client.close() }
```

The host borrows the command connection into the store and closes it after all its
limiter work. Constructing this provider opens no socket and starts no timer.
Namespace accepts 1..64 ASCII letters/digits/_/-. maxConcurrent defaults to 16 and
accepts 1..1024 active commands; excess work fails CAPACITY without a Redis command.
The Node transport has its own admission/deadline limits.

One literal key contains the versioned namespace, base64url ASCII scope and
existing SHA-256 subject digest. Raw subjects never reach Redis. The value is a
bounded canonical v1 policy/count/absolute-deadline string. An EVAL script samples
TIME, reads and validates current value/PEXPIRETIME, checks policy, then performs
one final SET with PXAT. Exactly limit attempts are admitted. Denials saturate at
limit+1 and retain the same absolute expiry. A different live policy fails with
POLICY_MISMATCH without writing; after native expiry a new policy can start.
Malformed state or a missing/mismatched expiry fails closed without repairing it.

The script's reads/validation precede its single write. [Redis script isolation](https://redis.io/docs/latest/develop/programmability/eval-intro/) is
atomic; Lua errors do not imply general transaction rollback. A native write error
returns no decision. A lost reply can leave an already committed attempt; the
provider and connection do not retry it. Explicit retry consumes another attempt.
See [failure/ownership](redis-rate-limit-lifecycle.md).

Redis owns physical/logical TTL expiry. prune(limit) validates its bound and returns
zero without SCAN, deletion or a maintenance connection. There is no global entry
cap; deployment owns memory and noeviction policy. TTL is preserved through normal
denials, and close never removes remote keys. See [deployment](redis-rate-limit-deployment.md)
and [actual native evidence](redis-rate-limit-testing.md).

Uses Redis 7+ [TIME](https://redis.io/docs/latest/commands/time/),
[EVAL](https://redis.io/docs/latest/commands/eval/),
[SET PXAT](https://redis.io/docs/latest/commands/set/) and
[PEXPIRETIME](https://redis.io/docs/latest/commands/pexpiretime/).
Standalone Redis is verified; cluster routing, failover consistency and provider
transports for Bun/Deno/Workers remain separate work.
