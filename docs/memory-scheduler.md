# Memory schedule storage

Owner: `@longhornjs/scheduler/memory` (`MemorySchedulerStore`). Connects
[schedules](scheduler.md) to the [memory queue](memory-queue.md).

```ts
const store = new MemorySchedulerStore()
const queue = new Queue({ name: 'reports.v1', schema, store: store.queueStore })
const scheduler = new Scheduler({ store })
```

One store owns its schedule Map and one paired MemoryQueueStore. All consumers
must share that queueStore object. Share the same scheduler store between multiple
coordinators to test concurrent ticks. Separate stores/processes/isolates are
independent, even if they use identical schedule IDs.

Schedule registration/get/cancel/dispatch are serialized through a neutral promise
tail. Insertion precedes cursor advancement; schedule API observations wait for
the admitted operation. The concrete paired memory queue has no external I/O.
This provider supplies per-occurrence coordination within one isolate; unlike
SQLite's whole-tick transaction, earlier completed occurrences are not rolled back
if a later occurrence fails. Mutating/replacing paired provider methods is outside
the contract. Returned timing/status records are detached from stored metadata.

There are no timers, capacity limits, retention purge, persistence or storage close.
Definitions and queued jobs live while their store is reachable. It is appropriate
for tests and explicitly transient workloads. Durable applications use the
[SQLite provider](scheduler-sqlite.md). The built Node/Bun/Deno/workerd contract
uses this paired provider as a portability test and makes no durable isolate claim.
