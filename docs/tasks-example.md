# Tasks application

Owner: `examples/basic`. This is the executable integration example for LongHorn's
implemented features. The executable uses SQLite and keeps tasks across restarts.

## What connects to what

| Part | Source | Connection |
| --- | --- | --- |
| Host entrypoint | [index.ts](../examples/basic/src/index.ts) | Reads Node environment, validates config, creates logger, starts app, handles signals |
| Configuration | [config.ts](../examples/basic/src/config.ts) | Standard Schema output becomes a typed settings provider |
| Application | [app.ts](../examples/basic/src/app.ts) | Hono routes resolve settings and task services through DI |
| Request schemas | [schemas.ts](../examples/basic/src/schemas.ts) | Zod schemas feed LongHorn validation middleware |
| Task service | [tasks.ts](../examples/basic/src/tasks.ts) | Async service depends on the TasksStore contract |
| Store startup | [storage.ts](../examples/basic/src/storage.ts) | Opens/migrates SQLite and registers database/store providers through lifecycle |
| SQL repository | [sqlite-tasks.ts](../examples/basic/src/sqlite-tasks.ts) | Parameterized CRUD maps database rows to tasks |
| Summary cache | [task-cache.ts](../examples/basic/src/task-cache.ts) | Typed cache/TTL, direct write invalidation, source fallback, cleanup |
| Event definitions and observations | [task-events.ts](../examples/basic/src/task-events.ts) | Typed events, scoped observer, process-local activity and metadata logs |
| HTTP hosting | [Node adapter](runtimes.md) | Binds only after lifecycle startup; closes before resource cleanup |
| Logs and cleanup | [Logging](logging.md), [lifecycle](lifecycle.md) | Correlated request logs and signal-driven `app.close()` |

`pnpm dev` builds workspace dependencies and watches the example. `pnpm build` followed
by `pnpm --filter example-basic start` runs built JavaScript. The entrypoint reads
optional `.env` / `.env.local` files beside `.env.example` in the example directory.
Settings are `APP_NAME`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_PATH`, and `CACHE_TTL_MS`; process values
win over files. The default database is `examples/basic/data/longhorn.sqlite`.
`DATABASE_PATH` resolves relative to the example directory, consistently in source
and built execution. An absolute path is supported; `:memory:` explicitly opts out
of persistence.

The data connection graph is `TaskDatabase -> TasksStore -> TasksService -> HTTP`.
The service also depends on `TaskEvents`; successful writes publish observations
consumed by `TaskActivity` and structured logs. See [task events](task-events.md).
Startup runs [migrations](migrations.md) before exposing the listener, then the DI
container creates the store and service lazily. [Shutdown](lifecycle.md) drains
requests, the event bus, and cache loaders before releasing the database. See [SQLite](sqlite.md) for adapter details.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/` | Framework, configured application name, and endpoint information |
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/tasks` | List stored tasks |
| GET | `/activity` | Current process event counters and latest event/request metadata |
| GET | `/summary` | Cached counts and timestamp, with local write invalidation and TTL for external writes |
| POST | `/tasks` | Validate and trim a title, create task, return 201 and Location |
| GET | `/tasks/:id` | Read a task or return 404 |
| PATCH | `/tasks/:id` | Validate a completed boolean, update task, or return 404 |
| DELETE | `/tasks/:id` | Delete task and return 204, or return 404 |

JSON writes require the appropriate Content-Type. Invalid schema input returns field
issues with status 400. Malformed JSON uses the framework's JSON error response.
All core requests get a response ID; enabled request logs use that same ID.

The example is persistent but is not yet authenticated. SQLite generates IDs;
committed creates, updates, deletions, and ID allocation survive restarts.
`createApp()` accepts an explicit store or expects startup to register one.
The [memory store](../examples/basic/src/test-support.ts) is only a test fixture.

Verification: [HTTP workflow](../examples/basic/src/app.test.ts),
[configuration](../examples/basic/src/config.test.ts), and
[shutdown draining](../examples/basic/src/lifecycle.test.ts). The
[storage suite](../examples/basic/src/storage.test.ts) uses real SQLite files and
concurrent HTTP requests. `pnpm test:persistence` builds the executable and verifies
separate-process restarts, simultaneous writers, and database integrity.

Task writes now await typed observations after commit. Subscriber failures are
logged as metadata and preserve successful write responses. Activity is not durable
and resets when a process restarts; tasks remain durable. [The event guide](task-events.md)
records this policy, ownership order, and verification.

The [task summary cache](task-cache.md) is a separate derived view. It does not cache
the list/detail API or authentication. Its guide records consistency, error fallback,
and event/cache/database lifetime ordering.
