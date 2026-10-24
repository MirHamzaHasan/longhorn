# LongHorn

A modular, TypeScript-first application framework built around Hono and Web Standards.
Shared packages use `Request` and `Response`; runtime adapters own the server.

## Create an application

From this checkout:

```sh
pnpm install
pnpm create:app ../my-api --runtime node
cd ../my-api
pnpm install
pnpm dev
```

Choose `node`, `bun`, `deno`, or `workers` explicitly. The generated project includes
a runnable app, tests, feature guides, and its selected framework snapshot, so it
works outside this monorepo. Add `--install` to install after creation. See the
[CLI](docs/cli.md), [project generator](docs/project-generation.md), and
[starter templates](docs/starter-templates.md). These packages are not published yet.

For an independent persistent Workers app, use
`pnpm create:app ../my-d1-api --runtime workers --template d1-tasks`.
The [D1 starter](docs/d1-starter.md) includes editable tasks/activity/replay,
private schema deployment, retained local data and source watching.

For local Node persistence, use
`pnpm create:app ../local-tasks --runtime node --template sqlite-tasks`.
The [SQLite starter](docs/sqlite-starter.md) includes the real task service,
file storage, typed events, memory summary caching and native persistence tests.

For the same task application on native Bun, use
`pnpm create:app ../bun-tasks --runtime bun --template sqlite-tasks`.
The [Bun SQLite starter](docs/bun-sqlite-starter.md) includes native tests,
retained file storage and owned development reloads.

## Run the command console

```sh
pnpm install
pnpm demo:operator-accounts
```

Open **http://127.0.0.1:3010/console**. Create an account, submit numbers and
follow the command through delivery to its computed receipt. Operators can
inspect failures, retry delivery and read the recovery audit. This demo owns
temporary PostgreSQL and receiver data. See the [complete walkthrough](docs/command-application.md)
and [persistent host](docs/persistent-operator-host.md) for retained storage.

To use the complete app outside this checkout, run `pnpm package:command-app`.
The archive at `.artifacts/longhorn-command-app.tgz` includes editable source,
the framework snapshot, receiver and setup/backup guides. See
[independent distribution](docs/command-app-distribution.md),
[upgrade procedure](docs/command-app-upgrades.md) and [verified runtime scope](docs/supported-runtimes.md).

## Run the D1 Worker example

For persistent Workers storage, run `pnpm dev:d1` and open
http://127.0.0.1:3016/health. The [D1 example](examples/d1-worker/README.md)
adds revision-checked tasks, atomic activity and exact cursor pages using native
D1 batches. Its local host retains data and privately applies schema before
readiness; see [the provider](docs/workers-d1.md) and [deployment](docs/d1-deployment.md).
Optional [request keys](docs/d1-idempotency-http.md) replay creation after a lost
reply; task, activity and response writes commit together.

## Run the basic example

Requires Node.js 20.19.0+ and pnpm 12.6.0 (the version pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

This builds the framework dependencies and starts the basic example with source watching
at **http://127.0.0.1:3000**. Set `HOST` or `PORT` to change the address:

```sh
PORT=4000 pnpm dev
```

Optional `.env` and `.env.local` files are loaded from `examples/basic/`, with process
environment values taking precedence. Copy `examples/basic/.env.example` to one of
those files to set `APP_NAME`, `HOST`, `PORT`, `LOG_LEVEL`, and `DATABASE_PATH`.
Invalid settings stop startup before
the server listens. An explicit `PORT=0` selects an available ephemeral port.

The example is a persistent tasks API. SQLite data lives at
`examples/basic/data/longhorn.sqlite` by default and survives restarts. Set
`DATABASE_PATH` to change it; `DATABASE_PATH=:memory:` explicitly disables persistence.

```sh
curl http://127.0.0.1:3000/health

curl -i http://127.0.0.1:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Build something with LongHorn"}'

curl http://127.0.0.1:3000/tasks

# Set this to the ID returned by the create request above.
TASK_ID=1
curl -X PATCH "http://127.0.0.1:3000/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{"completed":true}'

curl -i -X DELETE "http://127.0.0.1:3000/tasks/$TASK_ID"
```

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Application information |
| GET | `/health` | Health response |
| GET | `/tasks` | Cursor page; limit (1–100), after and completed filters |
| GET | `/activity` | Process-local task event counts and latest request correlation |
| GET | `/summary` | Cached public task counts and computation timestamp |
| POST | `/tasks` | Create a task with a trimmed title of 1–200 characters |
| GET | `/tasks/:id` | Read a task |
| PATCH | `/tasks/:id` | Set `completed` to a boolean |
| DELETE | `/tasks/:id` | Delete a task; return 204 |

Lists return `{ tasks, nextCursor }` with 20 rows by default. Follow the cursor
until null to read the collection. [SQLite task pages](docs/sqlite-task-pages.md)
and [aggregate summaries](docs/sqlite-task-counts.md) stay bounded on Node/Bun;
[retained upgrades](docs/sqlite-task-read-upgrades.md) preserve existing tasks.

Task writes publish awaited [typed events](docs/events.md). `/activity` shows this
process's observations; counters reset on restart while tasks persist. See
[task events](docs/task-events.md) for delivery/error policy and cleanup.

The public `/summary` view uses a typed memory cache with a five-second default
TTL. Local writes invalidate it; external writes appear after expiry. Set
`CACHE_TTL_MS` from 0–3600000 to configure it. Normal task list/detail reads remain
uncached. See [task caching](docs/task-cache.md), [cache](docs/cache.md), and
[memory storage](docs/memory-cache.md).

For shared Redis-backed summaries, configure `examples/basic/.redis.env.example`
as described in the [Redis task guide](docs/redis-tasks-example.md), then run
`pnpm dev:redis-cache` (port 3013). SQLite remains authoritative; the optional
[Redis provider](docs/redis-cache.md), [JSON codec](docs/cache-json-codec.md) and
[Node connection](docs/redis-node.md) reuse the same DI and lifecycle boundaries.

Invalid bodies return 400. Schema failures include field paths and messages. Missing
tasks and unknown paths return 404. Ctrl+C closes the server.

## Build an application

```ts
import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { nodeRuntime } from '@longhorn/node'

const Greeting = token<{ say(name: string): string }>('greeting')
const app = new Longhorn()

app.container.register(provide(Greeting, {
  factory: () => ({ say: (name) => `Hello, ${name}` }),
}))

app.http.get('/hello/:name', (c) => {
  const greeting = c.get('container').resolve(Greeting)
  return c.json({ message: greeting.say(c.req.param('name')) })
})

const server = await app.listen(nodeRuntime, { port: 3000 })
console.log(server.url)
// await app.close() when your application's lifecycle ends.
```

`app.http` is the real Hono application: use Hono routers, middleware, validation helpers,
and custom error handlers directly. `app.fetch` is a bound Fetch handler that can also
be called without opening a socket:

```ts
const response = await app.fetch(new Request('http://localhost/hello/LongHorn'))
```

The container is scoped to the application and caches providers as singletons. It is
available in every route as `c.get('container')`; it is not a per-request container.
Typed environment bindings are available through `new Longhorn<{ API_KEY: string }>()`
and can be passed as the second argument to `app.fetch` by a host.

Request validation is available through `validate` from `@longhorn/validation/hono`.
Pass a Standard Schema-compatible schema and read the typed output from
`c.req.valid('json')`, `c.req.valid('query')`, or another Hono validation target.
The standalone `parse` and `safeParse` helpers also work outside HTTP. See
[validation](docs/validation.md) for examples and error formats.

Typed configuration is available from `@longhorn/config`. Its `loadConfig` helper
merges supplied records and validates them using Standard Schema. The Node-specific
`readEnv` helper from `@longhorn/node/config` reads environment variables and `.env`
files without changing `process.env`. See [configuration](docs/configuration.md).

`app.onStart()` and `app.onStop()` manage resources around listener startup and
shutdown; a startup hook can return its cleanup callback. `app.close()` drains
listeners and managed work before releasing resources. Use `app.run(callback)` for
non-HTTP work that shares startup and resource lifetime. See
[lifecycle](docs/lifecycle.md) and [application work](docs/application-work.md).

Pass `new Longhorn({ logger: createLogger(...) })` to enable structured request logs.
Each request gets a response ID and a correlated logger at `c.get('logger')`.
The example uses `LOG_LEVEL=info` by default. See [logging](docs/logging.md).

`@longhorn/database` defines the SQL and transaction boundary. The
`@longhorn/node/sqlite` adapter opens local SQLite databases, while application-owned
repositories map rows to domain objects. Startup applies checksummed migrations;
shutdown closes the connection after requests drain. See [database](docs/database.md),
[migrations](docs/migrations.md), and [SQLite](docs/sqlite.md).

The [feature index](docs/features.md) links every implemented feature to its guide,
dependencies, and example. [The roadmap](docs/roadmap.md) tracks the remaining work.

## Authentication example

```sh
pnpm dev:auth
```

This separate API runs at `http://127.0.0.1:3001` with local credentials, native
scrypt, SQLite-backed sessions, exact write-origin checks, role guards, and private
notes scoped to their owner. It creates no seed accounts. See the
[auth example](docs/auth-example.md) for registration/login commands and settings,
and [authentication](docs/authentication.md) for contracts and current limits.
Each authentication feature has its own guide in the feature index.

## Background jobs example

```sh
pnpm dev:jobs
curl -i http://127.0.0.1:3002/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
```

The separate report API returns 202 and a status location. A lifecycle-owned worker
computes the report, persists one result per job ID, and acknowledges the durable
SQLite job. Pending work and results survive restart. See [the jobs example](docs/jobs-example.md),
[queue contracts](docs/queues.md), [workers](docs/queue-workers.md), and
[SQLite provider](docs/queue-sqlite.md) for retries, leases, and at-least-once effects.

The same app accepts one-time, fixed-interval and UTC-cron definitions at
`POST /report-schedules`. Schedule state survives restart; SQLite inserts each
occurrence and advances its cursor atomically across local processes. Read/cancel
at `/report-schedules/:id`. See [scheduled reports](docs/scheduled-reports.md),
[scheduler](docs/scheduler.md), and [cron](docs/cron.md) for commands and missed-run policy.

The report app also exposes `/livez`, `/readyz`, `/metrics`, `/traces`, and
`/diagnostics`. Readiness checks SQL and enabled background services; HTTP metrics
use bounded route labels, and local traces connect request/producer spans. Worker
spans and metrics describe background attempts. See [observability](docs/observability.md)
and [report wiring](docs/jobs-observability.md). Portable/generated apps include
readiness, request metrics and a bounded local trace buffer too.

## PostgreSQL example

```sh
pnpm demo:postgres
```

This starts a temporary native PostgreSQL server and a tasks API at
http://127.0.0.1:3003; Ctrl+C removes that demo data. For a server you provision,
configure runtime/migration URLs and use `pnpm migrate:postgres` then `pnpm dev:postgres`.
See [the PostgreSQL example](docs/postgres-example.md), [provider](docs/postgres.md),
[roles](docs/postgres-roles.md), and [native setup](docs/postgres-local.md).
The app also runs [background task reports](docs/postgres-reports.md) with durable
[PostgreSQL queues](docs/queue-postgres.md) and [atomic schedules](docs/scheduler-postgres.md).
[Account routes](docs/postgres-accounts.md) add native credentials/sessions and
[private notes](docs/postgres-private-notes.md) under /account.

`POST /tasks/with-report` creates a task and its report job in one transaction:

```sh
curl -i http://127.0.0.1:3003/tasks/with-report \
  -H 'Content-Type: application/json' -d '{"title":"Save a task with its follow-up"}'
```

The 201 response contains task/job metadata, Location and Report-Location. Both
records commit together; a publication failure rolls back the task. Follow the
report location for processing status. The portable helper supports Node SQLite,
PostgreSQL and Object SQL through active database-owned executors. See
[transaction publishing](docs/transaction-publishing.md),
[the route](docs/task-report-transactions.md) and [native proof](docs/transaction-publishing-testing.md).

Add `-H 'Idempotency-Key: create-task-123'` to that request to save and replay its
committed task/job result for 24 hours. Reusing an unexpired key with a changed
normalized title returns 409. Matching retries keep the original response and
locations, including after restart. See [idempotency](docs/idempotency.md) and
[the HTTP contract](docs/idempotency-http.md).

## Outgoing broker messages

```sh
pnpm dev:outbox-worker
curl -i http://127.0.0.1:3009/commands \
  -H 'Content-Type: application/json' \
  -d '{"id":"request-123","numbers":[2,4,6]}'
```

The command, replayable request result and outgoing record commit together. A
native Object alarm publishes to a broker; the consumer stores one SQL receipt per
stable application message ID. Follow the returned delivery/receipt locations.
Matching request IDs replay; changed input returns 409. See [Outbox](docs/outbox.md),
[the pipeline](docs/outbox-worker-example.md) and [native proof](docs/outbox-testing.md).

Optional [operations routes](docs/outbox-operations-http.md) provide bounded
delivery metadata pages and failed-message retries with the same application ID.
They require an explicitly configured [operations credential](docs/outbox-operations-authorization.md).
Retries use the observed attempt ceiling, preserve cumulative attempts and cap the
resulting lifetime ceiling at 100; stale/concurrent actions return a conflict.

Operations retries now append [audit history](docs/outbox-audit.md) with a
server-bound service actor and reason code in the same transaction. Authorized
GET /operations/audit returns bounded history that survives delivery cleanup.
See [HTTP](docs/outbox-audit-http.md), [attribution](docs/outbox-audit-attribution.md)
and [audit schema/privileges](docs/outbox-audit-storage.md).

## Telemetry collector demos

```sh
pnpm demo:tracing
```

This starts a temporary native OpenTelemetry Collector and reports API at
http://127.0.0.1:3004. POST /reports produces server/background traces; the console
shows collector reception. Ctrl+C drains both and removes demo data. See
[report tracing](docs/jobs-otlp.md), [OTLP delivery](docs/otlp-delivery.md) and
[collector setup/verification](docs/otlp-native.md).

Run `pnpm demo:metrics` for actual cumulative metrics from the same reports app on
http://127.0.0.1:3014. It pushes through an owned collector every second while
Prometheus scraping and local tracing stay available. The
[metric reader](docs/metric-reader.md), [OTLP metrics](docs/otlp-metrics.md),
[host settings](docs/jobs-metrics-export.md) and [native proof](docs/otlp-metrics-testing.md)
have separate connection and lifetime guides.

Run `pnpm demo:logs` for local console output plus remote structured logs from the
reports API at http://127.0.0.1:3015. A [bounded processor](docs/log-processing.md)
keeps logging synchronous and drains final records during application shutdown.
[Sink composition](docs/logger-sinks.md), [OTLP encoding](docs/otlp-logs-json.md),
[host projection/settings](docs/jobs-logs-export.md) and [native proof](docs/otlp-logs-testing.md)
each have a guide.

## Other runtimes

Automatic report scheduling through Durable Object alarms is runnable at port 3008:

```sh
pnpm dev:alarm-worker
curl -i http://127.0.0.1:3008/report-schedules \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[2,4,6],"at":0}'
curl http://127.0.0.1:3008/report-schedules/first
```

Native alarms process work automatically. Schedule/queue updates and alarm rearming
share one SQL transaction; retry and lease deadlines also wake the owner. The local
launcher activates its known Object once at startup to restore the pinned runtime's
alarm index. See [the example](docs/alarm-report-example.md),
[recovery/local limits](docs/alarm-recovery.md) and [native proof](docs/workers-alarm-testing.md).

The platform queue receipt app runs at http://127.0.0.1:3007:

```sh
pnpm dev:queue-worker
curl -i http://127.0.0.1:3007/messages \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[2,4,6]}'
curl http://127.0.0.1:3007/receipts/first
```

The local broker automatically delivers messages to bounded handlers. Poll the
receipt until processing finishes. Object SQL keeps the first result per business
ID across restarts; pending local broker deliveries remain transient. See
[the example](docs/queue-worker-example.md), [ack/retry policy](docs/queue-message-decisions.md)
and [native verification/local broker limits](docs/workers-queue-testing.md).

The durable Workers report app persists jobs, schedules and results in Object SQL:

```sh
pnpm dev:durable-worker
```

It runs at http://127.0.0.1:3006 and retains local data across restarts. Platform
scheduled events dispatch/process bounded batches using the existing queue and
scheduler stores over the new Object database adapter. See
[the example](docs/workers-durable-example.md), [provider](docs/workers-durable-sqlite.md)
and [native rollback/restart proofs](docs/workers-durable-testing.md).

The Workers scheduled-event example is also runnable:

```sh
pnpm dev:scheduled-worker
curl 'http://127.0.0.1:3005/cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time=1790000000000'
curl http://127.0.0.1:3005/scheduled/last
```

This dispatches a real local workerd event through the pinned Miniflare control
route. One invocation-owned scheduler/queue pipeline writes a stable KV audit key
and flushes its consumer trace. Queue/cursor state stays in memory; local KV is
temporary. The adapter shares application startup with HTTP and retains accepted
work through cooperative cancellation and shutdown. See the
[example](docs/workers-scheduled-example.md), [adapter](docs/workers-scheduled.md),
[invocation limits](docs/scheduled-invocations.md) and
[native verification](docs/workers-scheduled-testing.md). Generated Workers starters
include a scheduled handler and their own feature guide too.

```sh
pnpm dev:bun
pnpm dev:deno
pnpm dev:workers
```

These commands build and run the [portable example](docs/portable-example.md) using
local pinned runtimes. Choose another `PORT` to run beside the Node tasks app.
Bun and Deno use native listeners; Workers runs locally through workerd/Miniflare.
The Deno launcher grants loopback networking and the example's environment keys.
The portable example does not import the Node SQLite provider.

See [Bun](docs/bun.md), [Deno](docs/deno.md), and [Workers](docs/workers.md) for APIs,
permissions, platform lifetime differences, and verified tooling versions.

`pnpm dev:bun-sqlite` runs the [persistent Bun task API](docs/bun-sqlite-tasks.md)
using native `bun:sqlite` and the existing task service/repository. The optional
[Bun storage entrypoint](docs/bun-sqlite.md) supports async callback transactions
and managed publishers; native SQL itself executes synchronously.

## Checks and built execution

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:persistence
pnpm test:runtimes
pnpm test:bun-sqlite
pnpm test:worker-scheduled
pnpm test:worker-storage
pnpm test:d1
pnpm test:d1-idempotency
pnpm test:d1-project
pnpm test:sqlite-project
pnpm test:worker-queues
pnpm test:worker-alarms
pnpm test:transaction-publishing
pnpm test:idempotency
pnpm test:outbox
pnpm test:outbox-recovery
pnpm test:outbox-audit
pnpm test:projects
pnpm test:auth
pnpm test:events
pnpm test:cache
pnpm test:redis-cache
pnpm test:queues
pnpm test:scheduler
pnpm test:observability
pnpm test:otlp
pnpm test:otlp-metrics
pnpm test:otlp-logs
pnpm test:postgres
pnpm --filter example-basic start
```

The build emits JavaScript and declarations for the implemented framework packages.
Tests resolve workspace sources directly and cover the existing container and runtime
registry, HTTP behavior, DI in handlers, Node startup and shutdown, and the example's
complete HTTP workflow. Typechecking uses built workspace declarations, so build first.

## Current scope

- Working: dependency injection, runtime target metadata, Hono HTTP integration, portable
  server contracts, the Node adapter, schema validation, typed configuration,
  application lifecycle, structured logging, database contracts, migrations,
  Node SQLite persistence, Bun/Deno/Workers adapters, task/portable examples,
  a development CLI, standalone project starters, credentials, password hashing,
  sessions, cookie/origin checks, authorization, the persistent auth example,
  typed events, subscription ownership, task/portable/starter event observations,
  typed caching with memory TTL/LRU and invalidation, optional Redis storage,
  schema-validated JSON, owned Node Redis TCP/TLS and task-summary integration,
  typed durable queues,
  SQLite job claims/retries/leases, workers, a persistent reports example,
  durable scheduling, UTC cron, atomic dispatch, cancellation, owned timers,
  explicit readiness, bounded metrics/Prometheus text, portable tracing/export,
  request/background diagnostics, native PostgreSQL pooling/transactions,
  schema-scoped migrations, restricted-role PostgreSQL tasks, durable PostgreSQL
  queue/schedule providers, idempotent background task reports, PostgreSQL credentials/
  sessions/shared throttling, account HTTP and owner-scoped private notes,
  bounded OTLP/HTTP trace/metric export, cumulative readers with serial point batches,
  remote report observations, buffered OTLP logs with explicit sink fanout/final drain,
  and native collector QA,
  managed non-HTTP work, bounded Workers scheduled events, awaited consumer traces,
  a runnable KV audit pipeline, Durable Object SQLite transactions/migrations,
  persistent Worker queues/schedules/reports, platform queue events with explicit
  ack/retry decisions, bounded batch ownership, consumer tracing, receipt effects
  native workerd/broker verification, atomic Object alarm projection, persisted
  wakeup/backoff state, automatic report batches, lease/interruption recovery,
  managed transaction ownership and atomic validated job publishing with business writes,
  durable request idempotency, bounded JSON replay, scoped fingerprint conflicts,
  expiry/pruning and retry-safe task/report requests across SQL hosts,
  transactional broker outboxes, stable message identities, bounded terminal
  retention, native queue publishing and an automatic command/broker/receipt pipeline,
  bounded metadata inspection, conditional stable-ID failed-delivery retry and
  opt-in authorized operations with native upgrade/concurrency/recovery checks,
  atomic recovery audit, server-derived service attribution, bounded durable
  history and independent privileged audit retention, transaction-locked account
  authorization, trusted operator provisioning/session revocation, shared Hono
  operations routes and account-owned commands with verified user audit identities,
  bounded authenticated JSON clients, strict HTTP delivery acknowledgements,
  protected persistent receivers, conflicting-effect detection and a restricted
  persistent account operations host with restart/outage recovery, native D1
  atomic batches, guarded schema deployment and retained revision-checked Worker
  tasks/activity with exact integer pagination, optional replayable D1 creation
  and positive committed-result recovery after acknowledgement loss.
- Planned integrations include additional database providers, telemetry protocols/
  signals and platform triggers; their guarantees need native verification.

Run `pnpm demo:operator-accounts` for the [account operations demo](docs/operator-accounts-demo.md),
backed by temporary PostgreSQL and the real local broker/receipt consumer.
`pnpm test:operator-accounts` verifies account policy, native lock races and rollback.
For retained development data, follow the [persistent host guide](docs/persistent-operator-host.md)
and run `pnpm dev:message-receiver` plus `pnpm dev:operator-host` against your
provisioned database and configured service credential. `pnpm test:persistent-operations`
verifies both actual hosts restarting and publisher interruption after remote commit.
GET `/account/commands` provides bounded account history with live delivery
metadata; `pnpm test:command-history` verifies upgrade, isolation and restart traversal.
The [v0.1 plan](docs/v0.1-plan.md) now includes the working web console, complete
example, independent locked application archive, setup/deployment and verified
offline restore. [The roadmap](docs/roadmap.md) tracks subsequent modules,
dependencies and required verification.

The API is an early foundation. See [the architecture](docs/architecture.md) for package
boundaries and [the example](examples/basic/src/app.ts) for the complete application.
