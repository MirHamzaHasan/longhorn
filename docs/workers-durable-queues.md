# Durable queues inside a Worker Object

Owner: existing `@longhorn/queue/sqlite` (`SqliteQueueStore`) over
`@longhorn/workers/durable-sqlite`. Connects [typed queue coordination](queues.md),
[SQL transactions](durable-sqlite-transactions.md), [migrations](durable-sqlite-migrations.md)
and [scheduled dispatch](workers-durable-scheduler.md). No second queue protocol is added.

```ts
const queue = new Queue({
  name: 'reports.v1', schema: reportSchema,
  store: new SqliteQueueStore(database),
})
const job = await queue.enqueue({ numbers: [2, 4, 6] })
await queue.runOnce(reportHandler)
```

The Object owns `database`; the schema/handler above are application services.
Include queueMigrations in its complete history. Pending jobs, attempts, retry
times, ownership tokens, leases and final states live in the Object's SQL tables.
They survive Object/isolate reconstruction when the same namespace/Object ID is
used. Different Object IDs have separate queues even when queue names match.

Claims choose a candidate and assign its attempt/token inside one native write
transaction. Conditional renewal/completion/failure fences expired or stale
owners. The existing SQLite protocol still governs retry, exhaustion and heartbeat
behavior; the platform provider supplies its transaction and numeric boundary.
Safe integer timestamps/attempts fit the provider; arbitrary int64 precision is
not inferred from SQLite's column type.

The [example](workers-durable-example.md) uses bounded `runOnce` attempts during a
platform scheduled event, not an always-running QueueWorker loop. Object eviction
can stop an attempt before acknowledgement. A later trigger recovers an expired
lease using the existing claim rules. No periodic isolate timer or automatic cloud
queue subscription is installed. Choose leases/batch sizes that fit actual event
lifetime and retain the [at-least-once effect policy](queue-workers.md).

The report effect inserts by stable job ID with ON CONFLICT DO NOTHING. A crash
between effect commit and acknowledgement can repeat the handler; the same effect
row is preserved. Transactions cover SQL state, not external network effects.
This is distinct from Cloudflare Queues' own broker and delivery batch API.

Close queue coordination before the database handle; storage remains owned by the
platform. The [native gate](workers-durable-testing.md) proves competing claims,
renewal/expiry recovery, stale-token fencing, persisted retries, pending work across
restart and report effects retained after another restart. The original
[SQLite queue guide](queue-sqlite.md) documents the shared store algorithms; its
Node-file host details apply to the Node provider, not this Object binding.
