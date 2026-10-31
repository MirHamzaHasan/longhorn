# Typed caching and shared loading

Owner: `@longhornjs/cache`. Runtime-neutral cache coordination over an exclusively
owned `CacheStore<T>`. It imports no HTTP, native, logger, database, or core package.
The first adapter is [memory storage](memory-cache.md); [task summaries](task-cache.md)
show DI, configuration, invalidation, error policy, and lifecycle integration.

```ts
import { Cache } from '@longhornjs/cache'
import { MemoryCacheStore } from '@longhornjs/cache/memory'

type Profile = { readonly name: string }
const cache = new Cache<Profile>(new MemoryCacheStore<Profile>(), { ttlMs: 5000 })

const profile = await cache.getOrLoad('public-profile', () => loadProfile())
const lookup = await cache.get('public-profile')
if (lookup.hit) console.log(lookup.value.name, lookup.expiresAt)
await cache.delete('public-profile')
await cache.close()
```

`loadProfile` above is an application data-source function. Every cache has one
declared value type; reads cannot reinterpret it through an arbitrary generic.
Use separate cache instances/stores for different schemas or ownership boundaries.

## Hits, expiry, and value ownership

`get` returns `{ hit: false }` or `{ hit: true, value, expiresAt }`. A cached
`undefined`, `null`, `false`, zero, or empty string is still a hit. The hit expiry is
an epoch-millisecond value or null. There is no truthiness-based miss detection.

The default TTL is 60 seconds. Constructor/per-write `ttlMs` accepts a nonnegative
safe integer in milliseconds, or explicit null for no expiry. Zero retains no new
entry and removes an existing entry on an explicit set. A `getOrLoad` TTL controls
newly loaded values; it does not change or bypass an existing hit. TTL starts when
the store writes the loaded result, not when a slow backend operation begins.

The default copy policy is `structuredClone`. Explicit sets snapshot their input
at admission. Reads and each shared-load waiter receive separate copies, so caller
mutation does not change retained cache state or another waiter's value. Cache
resolved, structured-cloneable data. Functions/promises and objects requiring custom
prototype/serialization behavior need an appropriate value design or explicit
`copy: (value: T) => T` policy. A custom policy must preserve T and the isolation your
application needs; an identity copy is appropriate only for truly immutable values.
The default invokes `globalThis.structuredClone` with its host receiver preserved.
This is verified in workerd; see [Cloudflare's invocation guidance](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors)
when supplying other runtime methods as custom callbacks.

Keys must be nonempty strings. The cache does not automatically include user,
tenant, locale, binding, or authorization identity in a key. Applications own those
boundaries. The examples cache public derived data only; authentication/session
checks and authoritative task reads remain uncached.

## Loading and invalidation

`getOrLoad(key, loader, options?)` shares the store lookup and backend loader among
concurrent callers for that key. The first admitted call supplies the loader and
TTL for that flight. Other keys can load independently. Hits skip the loader;
rejected loaders are not retained and a later call can retry.

`delete`, `clear`, and explicit `set` synchronously fence older flights at admission.
A later load cannot join that invalidated generation. An older loader already
running may still return its source snapshot to callers already waiting for it,
but it cannot overwrite a newer value or repopulate an invalidated key. Backend
work is not forcibly cancelled and invalidation does not wait for it.

Short store operations are ordered per key. Clear places a global barrier after
previously scheduled store operations and before later ones. Checks before a loaded
write prevent a stale result queued around a clear/delete from escaping that fence.
Generation bookkeeping is released after active operations finish rather than
retaining every key ever seen.

These guarantees cover one cache coordinator and its exclusively owned namespace.
They are not distributed locking or invalidation guarantees. External source writes
and other processes require an application policy such as TTL, explicit messages,
or a provider protocol with stronger versioning. [Task summaries](task-cache.md)
demonstrate the TTL boundary without weakening the original tasks API.

## Errors and lifecycle

Store failures reject with `CacheStoreError`, including `operation` and original
`cause`. Loader and copy failures retain their original rejection. There is no
implicit stale fallback, suppressed provider error, or automatic retry. Choose an
application fallback explicitly; the task service bypasses a failed cache while
retaining successful committed write results. Do not log arbitrary causes/values
without considering their contents.

`close()` immediately stops new admission with `CacheClosedError`, waits for all
accepted operations/loaders, then closes the store. Implicit loaded-value writes
are skipped once closing starts; existing waiters still receive their source value.
Repeated close calls share the same promise, including a cleanup failure. State
progresses from open through closing to closed. Delivery/loader errors remain with
their original caller and are not replayed by drain cleanup.

Acquire the cache after its data source and before resources such as event subscribers
that use it. Reverse cleanup then drains events, cache work, and finally the source.
Call close outside loaders whose work it waits for. A loader must not recursively
join its own key, create cyclic loading dependencies, or await its cache's close.
Return/await all backend work; detached work is not automatically owned. The initial
API does not force-cancel or time out a non-settling loader.

## Store contract and verification

`CacheStore<T>` supplies async `get`, `set`, `delete`, `clear`, and `close`. Set takes
a relative TTL. Get must exclude expired entries and preserve the hit/miss union.
Values passed through this low-level contract are borrowed internal snapshots;
adapters must not mutate them in place. Use the Cache manager for normal application
access and copying. Store lifetime belongs to that one manager; close need not erase
an external provider's persistent values, whereas clear explicitly invalidates its
owned namespace. The optional [Redis provider](redis-cache.md) connects through
an explicit [JSON codec](cache-json-codec.md) and [Node transport](redis-node.md).
Memory remains the default; stronger cross-host fencing needs its own protocol.

Unit and compile-only tests cover type boundaries, falsy hits, exact expiry, copying,
shared work, invalidation races, asynchronous provider barriers, failures, and drain.
`pnpm test:cache` runs built exports on Node, Bun, Deno, and browser-bundled workerd,
then checks real task HTTP, concurrent summaries, local invalidation, external-write
TTL, restart, and shutdown. Runtime/generated-project gates also exercise cached
public profiles after fresh installation.
