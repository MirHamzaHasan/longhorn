# Memory cache adapter

Owner: `MemoryCacheStore<T>` from `@longhorn/cache/memory`. Connects the typed
[cache coordinator](cache.md) to a bounded in-process Map. No native API, network,
background worker, interval, or per-entry timer is used.

```ts
const store = new MemoryCacheStore<Profile>({ maxEntries: 256 })
const cache = new Cache<Profile>(store, { ttlMs: 5000 })
```

The default capacity is 1000 entries. Capacity is a positive safe integer and limits
entry count, not total byte size. Every store instance has independent entries.
Share one Cache through application DI rather than creating it per request or
sharing its raw store among multiple coordinators.

## Expiry, eviction, and copies

Relative TTL is converted to an absolute deadline when set executes. The default
clock is Date.now; an injected `clock: () => number` supports deterministic tests.
Clock values and computed deadlines must be nonnegative/safe integers. At
`now >= expiresAt`, the entry is expired. Explicit null has no deadline and zero
removes the key without retaining a value. Wall-clock changes can affect lifetime;
this adapter does not promise monotonic time across process/system clock changes.

Expiry is lazy. Reading an expired key removes it. A set prunes expired entries
before applying capacity eviction, and the size getter prunes before reporting the
live entry count. Live reads and writes move a key to the most recently used end;
capacity overflow evicts the least recently used entry.

The store implements low-level borrowed snapshots. The Cache coordinator snapshots
inputs and copies outputs according to its copy policy; raw store users do not get
that isolation automatically. Treat the adapter as exclusively owned by its Cache.
Prefer plain data and immutable domain values at application boundaries.

## Ownership and limits

`MemoryCacheStore.close()` is idempotent, removes all retained entries, and rejects
later operations. The coordinator first drains accepted loaders/operations and then
closes the store. Restart creates an empty cache. There is no persistence, shared
isolate/process state, distributed invalidation, disk spill, background refresh,
tag index, or byte-budget enforcement.

The adapter does not know HTTP, authentication, DI, events, or database lifetime.
Applications decide keys and resource order; see [task caching](task-cache.md).
Memory contains application data while the process is running, so cache only values
appropriate to that application's ownership and retention policy.

## Verification

Tests verify hit/miss distinction, undefined and other falsy values, exact expiry,
explicit no-expiry/zero retention, TTL after slow loading, LRU behavior, expiry before
eviction, value isolation, and invalid inputs/clocks. The same built adapter runs
in the Node/Bun/Deno/workerd contract gate. No native cache API is mocked there.
