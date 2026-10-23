# SQLite idempotent producers

Owner: `@longhorn/idempotency/sqlite`, SqliteIdempotencyStore and
idempotencyMigrations. Connects [Node SQLite](sqlite.md), [transactional queues](sqlite-transaction-publishing.md),
[retention/schema](idempotency-storage.md) and [Object SQL](idempotency-workers.md).

Append idempotencyMigrations to the application's one complete immutable migration
history. Do not replace deployed task/queue/scheduler prefixes or migrate this list
independently against an existing history. The schema uses a STRICT table,
composite primary key and partial expiry index; all parameters remain native `?`.

```ts
const requests = new Idempotency({ store: new SqliteIdempotencyStore(database) })
const result = await requests.run({ scope: 'tasks:create:v1', key, input }, async tx => {
  const task = await tasks.createIn(tx, input.title)
  return { task, job: await enqueueInTransaction(queue, tx, { taskId: task.id }) }
})
```

The built-in Node provider starts a write transaction before the callback and
serializes competing native writers across processes. Its managed transaction
scope joins accepted job publishers before commit. Readers on independent
connections cannot see pending business/job/result records. Failure and process
interruption before commit leave all three absent; the next same-key request can
run. An interrupted response after commit replays the original JSON.

SQLite permits one native writer at a time; a hot key also competes with other
database writes. The provider bounds admission and busy handling. Busy/capacity/
connection failures propagate and do not become a guessed success or cached error.
Keep callbacks short and use native executor writes. Source tests use real in-memory
SQLite; [native verification](idempotency-testing.md) uses an owned on-disk database,
separate processes, SIGKILL, concurrent callers, expiry reuse and bounded pruning.
