# Examples tour

The full walkthrough of every runnable example, with ports, curl commands and settings.
This was the project README until the [website work](website.md) gave it a shorter one.

A modular, TypeScript-first application framework built around Hono and Web Standards.
Shared packages use `Request` and `Response`; runtime adapters own the server.

Start with the [architecture guide](project-guide.md) for the module map,
request-to-receipt flow, storage/runtime boundaries and operating paths. The
[development handoff](development-handoff.md) records the paused state,
committed baseline, local work and verification. [Feature guides](features.md)
and the [detailed architecture](architecture.md) explain individual connections.

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
[CLI](cli.md), [project generator](project-generation.md), and
[starter templates](starter-templates.md). These packages are not published yet.

For an independent persistent Workers app, use
`pnpm create:app ../my-d1-api --runtime workers --template d1-tasks`.
The [D1 starter](d1-starter.md) includes editable tasks/activity/replay,
private schema deployment, retained local data and source watching.

For local Node persistence, use
`pnpm create:app ../local-tasks --runtime node --template sqlite-tasks`.
The [SQLite starter](sqlite-starter.md) includes the real task service,
file storage, typed events, memory summary caching and native persistence tests.

For the same task application on native Bun, use
`pnpm create:app ../bun-tasks --runtime bun --template sqlite-tasks`.
The [Bun SQLite starter](bun-sqlite-starter.md) includes native tests,
retained file storage and owned development reloads.

For the native Deno version, use
`pnpm create:app ../deno-tasks --runtime deno --template sqlite-tasks`.
The [Deno SQLite project](deno-sqlite-starter.md) includes editable source,
native tests, scoped launch permissions and retained development reloads.

For native accounts, sessions and private notes, use
`pnpm create:app ../accounts-api --runtime node --template sqlite-auth --install`.
The [auth starter](auth-starter.md) also supports Bun/Deno, with actual native
passwords/SQLite, editable app tests, retained sessions and owned source reloads.

For the complete PostgreSQL console and protected receipt receiver, use
`pnpm create:app ../my-console --runtime node --template command-app --install`.
Build it, then follow its docs/setup.md for database roles, receiver and runtime
configuration. See the [command project](command-project.md).

## Run the command console

```sh
pnpm install
pnpm demo:operator-accounts
```

Open **http://127.0.0.1:3010/console**. Create an account, submit numbers and
follow the command through delivery to its computed receipt. The [command list](command-history-updates.md)
updates arrivals and delivery state while preserving your current view.
[Run again](command-rerun.md) reviews saved numbers before creating a separate command. Operators can
inspect failures, retry delivery and read the recovery audit. Account offers
[password changes](console-account.md) and [sign-in controls](console-session-controls.md). This demo owns
temporary PostgreSQL and receiver data. See the [complete walkthrough](command-application.md)
and [persistent host](persistent-operator-host.md) for retained storage.

To use the complete app outside this checkout, run `pnpm package:command-app`.
The archive at `.artifacts/longhorn-command-app.tgz` includes editable source,
the framework snapshot, receiver and setup/backup guides. See
[independent distribution](command-app-distribution.md),
[upgrade procedure](command-app-upgrades.md) and [verified runtime scope](supported-runtimes.md).

## Run the D1 Worker example

For persistent Workers storage, run `pnpm dev:d1` and open
http://127.0.0.1:3016/health. The [D1 example](../examples/d1-worker/README.md)
adds revision-checked tasks, atomic activity and exact cursor pages using native
D1 batches. Its local host retains data and privately applies schema before
readiness; see [the provider](workers-d1.md) and [deployment](d1-deployment.md).
Optional [request keys](d1-idempotency-http.md) replay creation after a lost
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
until null to read the collection. [SQLite task pages](sqlite-task-pages.md)
and [aggregate summaries](sqlite-task-counts.md) stay bounded on Node/Bun;
[retained upgrades](sqlite-task-read-upgrades.md) preserve existing tasks.

Task writes publish awaited [typed events](events.md). `/activity` shows this
process's observations; counters reset on restart while tasks persist. See
[task events](task-events.md) for delivery/error policy and cleanup.

The public `/summary` view uses a typed memory cache with a five-second default
TTL. Local writes invalidate it; external writes appear after expiry. Set
`CACHE_TTL_MS` from 0–3600000 to configure it. Normal task list/detail reads remain
uncached. See [task caching](task-cache.md), [cache](cache.md), and
[memory storage](memory-cache.md).

For shared Redis-backed summaries, configure `examples/basic/.redis.env.example`
as described in the [Redis task guide](redis-tasks-example.md), then run
`pnpm dev:redis-cache` (port 3013). SQLite remains authoritative; the optional
[Redis provider](redis-cache.md), [JSON codec](cache-json-codec.md) and
[Node connection](redis-node.md) reuse the same DI and lifecycle boundaries.

Invalid bodies return 400. Schema failures include field paths and messages. Missing
tasks and unknown paths return 404. Ctrl+C closes the server.

## Build an application

```ts
import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { nodeRuntime } from '@longhornjs/node'

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

Request validation is available through `validate` from `@longhornjs/validation/hono`.
Pass a Standard Schema-compatible schema and read the typed output from
`c.req.valid('json')`, `c.req.valid('query')`, or another Hono validation target.
The standalone `parse` and `safeParse` helpers also work outside HTTP. See
[validation](validation.md) for examples and error formats.

Typed configuration is available from `@longhornjs/config`. Its `loadConfig` helper
merges supplied records and validates them using Standard Schema. The Node-specific
`readEnv` helper from `@longhornjs/node/config` reads environment variables and `.env`
files without changing `process.env`. See [configuration](configuration.md).

`app.onStart()` and `app.onStop()` manage resources around listener startup and
shutdown; a startup hook can return its cleanup callback. `app.close()` drains
listeners and managed work before releasing resources. Use `app.run(callback)` for
non-HTTP work that shares startup and resource lifetime. See
[lifecycle](lifecycle.md) and [application work](application-work.md).

Pass `new Longhorn({ logger: createLogger(...) })` to enable structured request logs.
Each request gets a response ID and a correlated logger at `c.get('logger')`.
The example uses `LOG_LEVEL=info` by default. See [logging](logging.md).

`@longhornjs/database` defines the SQL and transaction boundary. The
`@longhornjs/node/sqlite` adapter opens local SQLite databases, while application-owned
repositories map rows to domain objects. Startup applies checksummed migrations;
shutdown closes the connection after requests drain. See [database](database.md),
[migrations](migrations.md), and [SQLite](sqlite.md).

The [feature index](features.md) links every implemented feature to its guide,
dependencies, and example. [The roadmap](roadmap.md) tracks the remaining work.

## Authentication example

```sh
pnpm dev:auth
pnpm dev:auth:bun
pnpm dev:auth:deno
```

This separate API runs at `http://127.0.0.1:3001` with local credentials, native
scrypt, SQLite-backed sessions, exact write-origin checks, role guards, and private
notes scoped to their owner in bounded cursor pages. Node, Bun and Deno select
native password/SQLite adapters behind the same app and compatible retained state.
It creates no seed accounts. See [native hosts](native-auth-example.md) and the
[auth example](auth-example.md) for registration/login commands and settings,
and [authentication](authentication.md) for contracts and current limits.
Each authentication feature has its own guide in the feature index.

Native auth apps also expose [authenticated password changes](password-change-http.md)
with current-password verification and atomic all-session revocation. Current SQL
login paths [fence stale verifiers](password-session-fencing.md). The PostgreSQL
operator API uses an [appended restricted deployment](postgres-password-changes.md);
`pnpm test:password-changes` checks native races, crash rollback and KDF drain.

## Background jobs example

```sh
pnpm dev:jobs
curl -i http://127.0.0.1:3002/reports \
  -H 'Content-Type: application/json' -d '{"numbers":[2,4,6]}'
```

The separate report API returns 202 and a status location. A lifecycle-owned worker
computes the report, persists one result per job ID, and acknowledges the durable
SQLite job. Pending work and results survive restart. See [the jobs example](jobs-example.md),
[queue contracts](queues.md), [workers](queue-workers.md), and
[SQLite provider](queue-sqlite.md) for retries, leases, and at-least-once effects.

`pnpm demo:rust-reports` runs the [optional native workflow](rust-reports-demo.md)
with Rust 1.97.1: a protected Rust service computes a report, the existing worker
persists it, and Ctrl+C drains both processes and removes temporary data.
See [protocol](rust-reports.md), [typed client](native-report-client.md)
and [jobs configuration](jobs-native-reports.md). Ordinary apps keep local
computation unless the native backend is explicitly configured.

For retained data with Rust managed by the jobs app, run `pnpm dev:jobs-native`.
The [owned host](native-jobs-host.md) starts/probes Rust before HTTP readiness
and releases it after report calls drain. [Process ownership](managed-node-process.md),
[async DI acquisition](report-computer-resources.md) and
[native integration](owned-native-reports.md) each have a guide.

The same app accepts one-time, fixed-interval and UTC-cron definitions at
`POST /report-schedules`. Schedule state survives restart; SQLite inserts each
occurrence and advances its cursor atomically across local processes. Read/cancel
at `/report-schedules/:id`. See [scheduled reports](scheduled-reports.md),
[scheduler](scheduler.md), and [cron](cron.md) for commands and missed-run policy.

The report app also exposes `/livez`, `/readyz`, `/metrics`, `/traces`, and
`/diagnostics`. Readiness checks SQL and enabled background services; HTTP metrics
use bounded route labels, and local traces connect request/producer spans. Worker
spans and metrics describe background attempts. See [observability](observability.md)
and [report wiring](jobs-observability.md). Portable/generated apps include
readiness, request metrics and a bounded local trace buffer too.

## PostgreSQL example

```sh
pnpm demo:postgres
```

This starts a temporary native PostgreSQL server and a tasks API at
http://127.0.0.1:3003; Ctrl+C removes that demo data. For a server you provision,
configure runtime/migration URLs and use `pnpm migrate:postgres` then `pnpm dev:postgres`.
See [the PostgreSQL example](postgres-example.md), [provider](postgres.md),
[roles](postgres-roles.md), and [native setup](postgres-local.md).
The app also runs [background task reports](postgres-reports.md) with durable
[PostgreSQL queues](queue-postgres.md) and [atomic schedules](scheduler-postgres.md).
[Account routes](postgres-accounts.md) add native credentials/sessions and
[private notes](postgres-private-notes.md) under /account.

`POST /tasks/with-report` creates a task and its report job in one transaction:

```sh
curl -i http://127.0.0.1:3003/tasks/with-report \
  -H 'Content-Type: application/json' -d '{"title":"Save a task with its follow-up"}'
```

The 201 response contains task/job metadata, Location and Report-Location. Both
records commit together; a publication failure rolls back the task. Follow the
report location for processing status. The portable helper supports Node SQLite,
PostgreSQL and Object SQL through active database-owned executors. See
[transaction publishing](transaction-publishing.md),
[the route](task-report-transactions.md) and [native proof](transaction-publishing-testing.md).

Add `-H 'Idempotency-Key: create-task-123'` to that request to save and replay its
committed task/job result for 24 hours. Reusing an unexpired key with a changed
normalized title returns 409. Matching retries keep the original response and
locations, including after restart. See [idempotency](idempotency.md) and
[the HTTP contract](idempotency-http.md).

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
Matching request IDs replay; changed input returns 409. See [Outbox](outbox.md),
[the pipeline](outbox-worker-example.md) and [native proof](outbox-testing.md).

Optional [operations routes](outbox-operations-http.md) provide bounded
delivery metadata pages and failed-message retries with the same application ID.
They require an explicitly configured [operations credential](outbox-operations-authorization.md).
Retries use the observed attempt ceiling, preserve cumulative attempts and cap the
resulting lifetime ceiling at 100; stale/concurrent actions return a conflict.

Operations retries now append [audit history](outbox-audit.md) with a
server-bound service actor and reason code in the same transaction. Authorized
GET /operations/audit returns bounded history that survives delivery cleanup.
See [HTTP](outbox-audit-http.md), [attribution](outbox-audit-attribution.md)
and [audit schema/privileges](outbox-audit-storage.md).

## Telemetry collector demos

```sh
pnpm demo:tracing
```

This starts a temporary native OpenTelemetry Collector and reports API at
http://127.0.0.1:3004. POST /reports produces server/background traces; the console
shows collector reception. Ctrl+C drains both and removes demo data. See
[report tracing](jobs-otlp.md), [OTLP delivery](otlp-delivery.md) and
[collector setup/verification](otlp-native.md).

Run `pnpm demo:metrics` for actual cumulative metrics from the same reports app on
http://127.0.0.1:3014. It pushes through an owned collector every second while
Prometheus scraping and local tracing stay available. The
[metric reader](metric-reader.md), [OTLP metrics](otlp-metrics.md),
[host settings](jobs-metrics-export.md) and [native proof](otlp-metrics-testing.md)
have separate connection and lifetime guides.

Run `pnpm demo:logs` for local console output plus remote structured logs from the
reports API at http://127.0.0.1:3015. A [bounded processor](log-processing.md)
keeps logging synchronous and drains final records during application shutdown.
[Sink composition](logger-sinks.md), [OTLP encoding](otlp-logs-json.md),
[host projection/settings](jobs-logs-export.md) and [native proof](otlp-logs-testing.md)
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
alarm index. See [the example](alarm-report-example.md),
[recovery/local limits](alarm-recovery.md) and [native proof](workers-alarm-testing.md).

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
[the example](queue-worker-example.md), [ack/retry policy](queue-message-decisions.md)
and [native verification/local broker limits](workers-queue-testing.md).

The durable Workers report app persists jobs, schedules and results in Object SQL:

```sh
pnpm dev:durable-worker
```

It runs at http://127.0.0.1:3006 and retains local data across restarts. Platform
scheduled events dispatch/process bounded batches using the existing queue and
scheduler stores over the new Object database adapter. See
[the example](workers-durable-example.md), [provider](workers-durable-sqlite.md)
and [native rollback/restart proofs](workers-durable-testing.md).

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
[example](workers-scheduled-example.md), [adapter](workers-scheduled.md),
[invocation limits](scheduled-invocations.md) and
[native verification](workers-scheduled-testing.md). Generated Workers starters
include a scheduled handler and their own feature guide too.

```sh
pnpm dev:bun
pnpm dev:deno
pnpm dev:workers
```

These commands build and run the [portable example](portable-example.md) using
local pinned runtimes. Choose another `PORT` to run beside the Node tasks app.
Bun and Deno use native listeners; Workers runs locally through workerd/Miniflare.
The Deno launcher grants loopback networking and the example's environment keys.
The portable example does not import the Node SQLite provider.

See [Bun](bun.md), [Deno](deno.md), and [Workers](workers.md) for APIs,
permissions, platform lifetime differences, and verified tooling versions.

`pnpm dev:bun-sqlite` runs the [persistent Bun task API](bun-sqlite-tasks.md)
using native `bun:sqlite` and the existing task service/repository. The optional
[Bun storage entrypoint](bun-sqlite.md) supports async callback transactions
and managed publishers; native SQL itself executes synchronously.

`pnpm dev:deno-sqlite` runs the same persistent task API at
http://127.0.0.1:3017 using [Deno storage](deno-sqlite.md) and explicit file
permissions. The [host](deno-sqlite-tasks.md),
[binding slots](deno-sqlite-bindings.md), [async transactions](deno-sqlite-transactions.md)
and [native tests](deno-sqlite-testing.md) explain the connections.

## Checks and built execution

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:persistence
pnpm test:runtimes
pnpm test:bun-sqlite
pnpm test:deno-sqlite
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
pnpm test:native-auth
pnpm test:events
pnpm test:cache
pnpm test:redis-cache
pnpm test:queues
pnpm test:scheduler
pnpm test:observability
pnpm test:owned-native
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
  and positive committed-result recovery after acknowledgement loss, optional
  versioned Rust report computation, portable typed native calls, and owned Node
  process resources with a persistent lifecycle-managed Rust jobs host.
- Planned integrations include additional database providers, telemetry protocols/
  signals and platform triggers; their guarantees need native verification.

Run `pnpm demo:operator-accounts` for the [account operations demo](operator-accounts-demo.md),
backed by temporary PostgreSQL and the real local broker/receipt consumer.
`pnpm test:operator-accounts` verifies account policy, native lock races and rollback.
For retained development data, follow the [persistent host guide](persistent-operator-host.md)
and run `pnpm dev:message-receiver` plus `pnpm dev:operator-host` against your
provisioned database and configured service credential. `pnpm test:persistent-operations`
verifies both actual hosts restarting and publisher interruption after remote commit.
GET `/account/commands` provides bounded account history with live delivery
metadata; `pnpm test:command-history` verifies upgrade, isolation and restart traversal.
The [v0.1 plan](v0.1-plan.md) now includes the working web console, complete
example, independent locked application archive, setup/deployment and verified
offline restore. [The roadmap](roadmap.md) tracks subsequent modules,
dependencies and required verification.

The API is an early foundation. See [the architecture](architecture.md) for package
boundaries and [the example](../examples/basic/src/app.ts) for the complete application.

[Request attempt limits](request-limits.md) connect bounded memory and managed SQL to Hono.
The command application has a default-off authenticated account budget, checked by
startup/readiness/preflight and preserved by backup. Run pnpm test:rate-limits for
actual runtime, SQL contention/crash, upgrade and HTTP verification.

[Redis request limits](redis-rate-limits.md) add atomic server-clock budgets over the existing
Node connection. The protected report example runs with pnpm dev:redis-limits;
pnpm test:redis-limits verifies actual contention, TTL, ACL, crash recovery and
lost-reply HTTP shutdown. Each part has its guide in the feature index.

[Optional D1 task creation limits](d1-request-limits.md) now connect native database time, atomic
budgets, validation/replay and retained worker state. Run pnpm test:d1-rate-limits
for actual workerd rollback, concurrency, expiry, upgrade and shutdown evidence.
The generated starter ships its own policy guide and opt-in native tests.

[Optional Object report budgets](object-report-limits.md) share one quota
across direct and scheduled submissions, including the automatic-alarm profile:

```sh
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:durable-worker
REPORT_LIMIT_ENABLED=true REPORT_LIMIT_REQUESTS=3 pnpm dev:alarm-worker
```

Run either host independently. Background reports still complete after HTTP quota
exhaustion. Run `pnpm test:object-rate-limits` for native concurrency, upgrade,
interruption and retained-host proof. Each part has its own guide:
[store](object-request-limits.md), [deployment](object-limit-deployment.md),
[lifecycle](object-limit-lifecycle.md) and [verification](object-limit-testing.md).

[Owned budget cleanup](rate-limit-cleanup.md) now schedules bounded expiry
maintenance through the existing limiter. A [runnable SQLite report API](rate-limit-cleanup-example.md)
uses default-off cleanup; run `pnpm dev:maintained-limits` with a private API_TOKEN.
`pnpm test:limit-cleanup` checks native stores, locked shutdown and independently
packed/relocated packages. Both budget and request-ledger cleanup share one
[owned pruning loop](prune-worker.md).

The command application also ships [separate budget maintenance](command-limit-maintenance.md):
read-only check, one bounded batch or owned watch, with a restricted maintenance
identity. Workspace commands use `pnpm maintain:command-limits`; generated apps
use `pnpm maintain:limits`. [Provisioning](command-limit-maintenance-role.md)
keeps bucket DELETE outside the HTTP runtime. Run
`pnpm test:command-limit-maintenance` for native and independently installed proof.

[Active-session inventory](session-inventory.md) now connects native auth
stores to the [Account panel](console-session-inventory.md): bounded expiry/current
pages and selected sign-out using public references rather than bearer material.
The [appended schema](session-inventory-schema.md) preserves legacy writers.
Run `pnpm test:session-inventory` for native SQL/process, Object and browser proofs.
