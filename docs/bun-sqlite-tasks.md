# Persistent tasks on native Bun

Owner: [examples/bun-sqlite](../examples/bun-sqlite/src/index.ts). The Bun host imports
the existing basic app, configuration, task service, SQL repository, typed events
and summary cache. Only host/environment/database/listener wiring changes.
Its production imports do not include `@longhorn/node` or the libSQL driver.

```sh
pnpm install --frozen-lockfile
pnpm dev:bun-sqlite
# Or run a previously built host:
DATABASE_PATH=/absolute/path/tasks.sqlite PORT=3014 bun examples/bun-sqlite/dist/index.js
curl -H 'Content-Type: application/json' -d '{"title":"Run on Bun"}' http://127.0.0.1:3014/tasks
```

The dev command uses the pinned local Bun executable after building its dependency
graph. Unlike the Node source-watch starter, this command runs one compiled host;
rebuild/restart after edits. Configuration validates Bun.env using the shared schema:
APP_NAME, HOST, PORT, LOG_LEVEL, DATABASE_PATH and CACHE_TTL_MS. Defaults are
LongHorn, 127.0.0.1, 3000, info, ./data/longhorn.sqlite and 5000 ms. Bun itself may
load environment files; this host adds no custom environment-file merge policy.
Relative database paths resolve from examples/bun-sqlite for either source or built
entrypoints, and `:memory:` selects temporary storage.

Startup owns native SQLite, runs the existing immutable task migration, registers
TaskDatabase → TasksStore → TasksService through DI, then starts cache and event
resources before listening through Bun.serve. Failure releases acquired resources.
SIGTERM/SIGINT close HTTP, drain event/cache work and finally close SQLite through
the existing LongHorn lifecycle.

Routes remain GET /health, task CRUD at /tasks, GET /activity and GET /summary.
IDs are decimal strings. Validation, request IDs and structured logs use the same
application middleware. Tasks persist in the SQLite file across restarts and hosts.
Activity is a process-local observer, and summaries are process-local cached
derivations; another host's writes become visible after TTL or with CACHE_TTL_MS=0.
They are not durable audit history. The basic list/summary route has no pagination;
the provider's default 1000-row output limit remains explicit.

This example does not add revision/idempotency headers to task CRUD, production
account policy or cloud deployment. For an independent generated copy with owned
source watching, use the [Bun SQLite starter](bun-sqlite-starter.md). The optional
provider is available independently. See [storage](bun-sqlite.md),
[async ownership](bun-sqlite-transactions.md), [events](task-events.md),
[cache](task-cache.md) and [verification](bun-sqlite-testing.md).
