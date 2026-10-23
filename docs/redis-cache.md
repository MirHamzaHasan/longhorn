# Redis cache storage

Implemented and verified through the [native cache gate](redis-cache-testing.md).

Owner: `RedisCacheStore<T>` from `@longhorn/cache/redis`. It implements the existing
[CacheStore contract](cache.md) using an exclusively owned command client and an
explicit [persistence codec](cache-json-codec.md). It imports no Node/network/core
module. The [Node transport](redis-node.md) supplies actual Redis TCP/TLS ownership.

```ts
import { Cache } from '@longhorn/cache'
import { RedisCacheStore } from '@longhorn/cache/redis'
import { jsonCacheCodec } from '@longhorn/cache/json'
import { openRedis } from '@longhorn/node/redis'

// profileSchema is the application's runtime schema, for example a Zod schema.
const codec = jsonCacheCodec(value => profileSchema.parse(value))
const client = await openRedis({ url: redisUrl })
const cache = new Cache(new RedisCacheStore(client, { namespace: 'profiles', codec }), { ttlMs: 5000 })
try {
  await cache.set('public', profile)
  const entry = await cache.get('public')
  if (entry.hit) useProfile(entry.value)
} finally { await cache.close() }
```

Validate configuration before resource acquisition. If constructing a store/cache
fails after opening its client, close that client in the startup failure path;
the [task profile](redis-tasks-example.md) demonstrates that ownership boundary.

Each namespace is a bounded ASCII identifier. Keys become UTF-8 base64url names
under a fixed versioned prefix; glob characters in a key never become a SCAN
pattern. Unpaired UTF-16 surrogates and oversized keys/values are rejected. Ordinary
get/set/delete operate on one key. Redis 7+ Lua reads value/absolute expiry together
and rejects expiry overflow before SET. Null means persistent, zero removes the
entry without encoding a value, and positive TTL starts at the Redis write.
Server time and PEXPIRETIME own expiry; the client wall clock is not authoritative.

Clear walks SCAN with a literal namespace MATCH and bounded UNLINK batches. COUNT
is a Redis hint, so deletion chunks have their own size bound. The page budget
bounds total accepted traversal; exceeding it rejects with a partial clear rather
than claiming completion. No KEYS/FLUSHDB/FLUSHALL is used. The provider requires
standalone Redis; cluster-wide traversal is not implemented.

The existing Cache manager still owns copies, shared loads and generation fences.
Those fences cover one coordinator. Other hosts can read/write the same Redis
namespace, but an older foreign loader can repopulate after another host deletes.
Clear is not a snapshot under foreign concurrent writes. Applications need an
explicit TTL/invalidation policy, and authoritative/account reads stay uncached.
Redis deployment owns total memory/eviction/persistence policy; this adapter does
not promise a global entry count or distributed loader lock.

Accepted provider operations are bounded. Close stops admission, drains accepted
codec/command work, then closes its owned connection; it does not erase remote
values. Cache manager errors retain their operation classification. Transport
ambiguity is not retried. See [Redis SCAN](https://redis.io/docs/latest/commands/scan/),
[PEXPIRETIME](https://redis.io/docs/latest/commands/pexpiretime/) and
[UNLINK](https://redis.io/docs/latest/commands/unlink/) for server semantics.

Default limits are 1024 UTF-8 key bytes, 65536 encoded value bytes, 16 accepted
operations, SCAN count 100 and 10000 scan pages. Value bytes are checked after
driver decoding; this is not a RESP receive-buffer cap. Configure Redis memory
policy separately. User codecs/loaders must settle for cooperative close.
