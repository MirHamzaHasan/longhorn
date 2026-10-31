# Memory queue storage

Owner: `@longhornjs/queue/memory` (`MemoryQueueStore`). Connects to [queues](queues.md)
and [workers](queue-workers.md). This reference provider implements the same claim,
retry, expiry and token-fencing contract with a process-local Map.

```ts
const store = new MemoryQueueStore()
const queue = new Queue({ name: 'test.v1', schema, store })
```

Methods mutate synchronously before their Promise resolves, so calls in one
JavaScript isolate have atomic claim/transition behavior. Multiple queues/workers
can share a store instance. Separate instances/processes/isolates do not share work.
Rows contain serialized strings and reads return detached metadata records.

There are no timers, persistence, storage close, capacity bounds or retention purge.
Expired leases recover on a claim for that name. Due work orders by available time,
creation time, then ID. Completed and failed rows remain in memory while the store
is reachable. Use it for tests and explicit transient work, with application-owned
volume limits; choose [SQLite](queue-sqlite.md) for the durable example.

The shared store contract tests exercise this implementation beside SQLite.
The Node/Bun/Deno/workerd fixture checks portability through this provider without
claiming that an isolate-local Map supplies durable delivery.
