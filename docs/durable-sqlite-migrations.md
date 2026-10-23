# Durable Object SQL migrations

Owner: `@longhorn/database` migration coordinator with the
[Durable SQLite provider](workers-durable-sqlite.md). Connects the Object's private
schema to [application startup](lifecycle.md), [queues](workers-durable-queues.md)
and [schedule storage](workers-durable-scheduler.md).

```ts
const database = createDurableSqlite(state)
await migrate(database, [...queueMigrations, ...schedulerMigrations, ...appMigrations])
```

These are existing SQLite migration exports. Keep **one authoritative ordered
history for all tables in an Object**, rather than migrating each module's list
independently. The [report example](../examples/durable-worker/src/reports.ts) owns
that complete list. Append future migrations after its deployed prefix. Do not
reorder or rewrite prior SQL/checksums.

The shared coordinator computes checksums before opening its transaction, checks
the applied prefix, and applies new DDL/history rows within the provider's native
write transaction. A failure rolls back new schema/history together. Startup must
finish before serving routes. Acquire the provider in onStart, close it on startup
failure, and return close as the resource cleanup. Reconstructing an Object rechecks
the stored prefix; it does not create a new empty database.

Every named Object has its own database/history. A migration of one Object does
not eagerly upgrade all Object IDs. Plan compatible application rollouts and lazy
per-Object startup. Avoid external I/O in SQL transaction callbacks and preserve
the provider's [input-gate ownership](durable-sqlite-transactions.md).

## Class deployment versus SQL history

Cloudflare's `new_sqlite_classes` migration config creates a SQLite-backed Durable
Object class. That deployment declaration is separate from LongHorn's SQL schema
history inside each Object. The example's `wrangler.example.toml` illustrates the
class binding/migration plus a Cron Trigger; the local host configures its own
SQLite namespace directly. Neither local command deploys to an account.
See [Cloudflare class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

`pnpm test:worker-storage` runs real migrations before fixture/example use, then
reconstructs Objects and restarts workerd against the same temporary storage. It
checks stored jobs/definitions/results remain available after startup replay.
Checksum/order policy is shared with the existing [migration implementation](migrations.md);
[native storage tests](workers-durable-testing.md) additionally prove transaction
rollback and recovery across actual Object interruption.
