# Longhorn Framework Architecture

## Overview
Longhorn is a modern, modular, TypeScript-first application framework designed to provide a batteries-included developer experience while remaining runtime-portable, lightweight, and extensible.

The framework builds higher-level capabilities around **Web Standards** and **Hono** as its HTTP foundation.

---

## 1. Monorepo & Directory Structure

```
longhorn/
├── packages/              # Modular @longhorn/* framework packages
│   ├── core/              # Framework lifecycle, runtime target registry & contracts
│   ├── http/              # Web Standards HTTP abstractions & Hono bindings
│   ├── config/            # Configuration management & environment loading
│   ├── container/         # Dependency injection & inversion of control
│   ├── validation/        # Schema validation & request parsing
│   ├── events/            # Event emitter & pub/sub system
│   ├── logger/            # Structured logging interfaces & implementations
│   ├── database/          # Database abstraction layer & connection management
│   ├── auth/              # Authentication & authorization abstractions
│   ├── cache/             # Cache stores & adapter interfaces
│   ├── queue/             # Job queue & background task abstractions
│   ├── scheduler/         # Task scheduling & cron utilities
│   ├── observability/     # Metrics, tracing, and health check utilities
│   ├── idempotency/       # Durable request ownership and JSON result replay
│   ├── outbox/            # Transactional outgoing messages and broker delivery
│   └── runtime/           # Base runtime contracts & adapter interfaces
│
├── runtimes/              # JavaScript runtime adapters
│   ├── node/              # Node.js runtime adapter (@longhorn/node)
│   ├── bun/               # Bun runtime adapter (@longhorn/bun)
│   ├── deno/              # Deno runtime adapter (@longhorn/deno)
│   └── workers/           # Cloudflare Workers / Edge adapter (@longhorn/workers)
│
├── native/                # Optional native services space
│   └── rust/              # Future native Rust integrations (not a JS runtime adapter)
│
├── cli/                   # @longhorn/cli command-line interface
├── create-longhorn/       # Project generation entrypoint (local, unpublished)
├── examples/              # Usage examples & starter templates
│   ├── basic/             # Runnable Hono + DI tasks API on Node.js
│   ├── portable/          # Shared Bun/Deno/Workers application
│   └── auth/              # Durable credentials, sessions, and private notes
├── tests/                 # End-to-end and cross-package test suites
├── docs/                  # Architectural & user documentation
├── scripts/               # Repository maintenance & build scripts
└── tooling/               # Internal developer tooling & linters
```

---

## 2. Dependency Hierarchy & Isolation

Longhorn enforces strict unidirectional dependency flow:

```
                  Application Code
                        │
                        ▼
            Longhorn Framework Packages (@longhorn/*)
                        │
                        ▼
            HTTP / Runtime Abstractions (@longhorn/http, @longhorn/runtime)
                        │
                        ▼
            Hono / Web Standards (Request, Response, Fetch)
                        │
                        ▼
       Runtime Adapters (Node.js / Bun / Deno / Cloudflare Workers)
```

### Critical Rules for Contributors:
1. **Runtime Isolation**: Framework packages in `packages/*` (especially `@longhorn/core` and `@longhorn/http`) MUST NOT directly depend on Node.js-specific modules (e.g. `node:fs`, `node:net`, `node:buffer`). All environment-specific interactions must be mediated via runtime adapters in `runtimes/*`.
2. **Web Standards First**: All HTTP primitives should be built on standard `Request`, `Response`, `Headers`, and `Fetch API` implementations.
3. **Hono Boundary**: Hono is our HTTP foundation. Longhorn builds higher-level framework functionality around Hono without rewriting or duplicating Hono.
4. **Rust / Native Boundary**: Future native components live under `native/rust/`. Native components are optional and not JS runtime adapters.

---

## 3. Implemented HTTP Slice

`@longhorn/http` provides `createHttpApp()`, which creates a real Hono application
with JSON 404/500 defaults. Explicit Hono `HTTPException` responses retain their
status, body, and headers; message-only exceptions use JSON. Unexpected errors are logged server-side; the client gets
a generic 500 response. Applications can replace Hono's error and not-found handlers.

`@longhorn/core` composes that Hono application with an application-scoped
`@longhorn/container` instance. Routes and middleware remain native Hono APIs under
`app.http`; services are available through `c.get('container')`. `app.fetch` exposes
the bound Web Standard request handler, including typed environment bindings.

`@longhorn/runtime` defines `FetchApplication`, `ServeOptions`, `ServerHandle`, and
`RuntimeAdapter` without importing a particular JavaScript runtime. `app.listen()`
starts application resources, then delegates to an adapter supplied by application
code. Core never imports an adapter.

`@longhorn/node` implements this boundary using `@hono/node-server`. It resolves
startup after the socket binds, rejects startup errors, supports an ephemeral port
with `port: 0`, and returns the actual address and an idempotent async `close()`.
The Node adapter accepts the portable request-only Fetch contract; Node-specific
request/response bindings are not injected into application handlers.

```text
Application imports Longhorn + nodeRuntime
  -> app.http handles routing and middleware through Hono
  -> app.container provides application services
  -> app.listen(nodeRuntime) delegates startup
  -> Node adapter converts incoming HTTP to Request and writes Response
```

The existing `.runtime({ name, adapter })` registry remains descriptive metadata.
Registering a target does not start a server or load an adapter. Multi-target process
orchestration is not implemented yet. Bun/Deno native listeners and the Workers
Fetch adapter now use these boundaries, as described below.

`examples/basic` exercises the full path with a tasks API, body checks, 201/204/400/404
responses, and signal-driven Node shutdown. Its executable now uses the SQLite
resource integration described below; memory stores are explicit test fixtures.

---

## 4. Schema Validation

`@longhorn/validation` provides runtime-neutral `parse()` and `safeParse()` helpers
using Standard Schema. They accept synchronous or asynchronous schemas and retain
inferred output types, including transformations. The root entrypoint imports no
HTTP implementation. Schema failures carry normalized message/path issues;
exceptions from schema implementations propagate as application errors.

The `@longhorn/validation/hono` entrypoint exposes `validate(target, schema)` as a
thin wrapper around Hono's Standard Schema validator. Hono handles parsing and
typed `c.req.valid()` output. LongHorn formats schema failures as status 400 JSON
with `error`, `target`, and normalized `issues`, without returning the raw input or
vendor-specific issue properties. JSON, query, route parameters, forms, headers,
and cookies use Hono's existing target behavior.

The basic example keeps its schemas in `examples/basic/src/schemas.ts` and uses Zod
as an application dependency. Zod is only a development dependency of the framework's
validation package. Core does not import validation or a schema vendor. Applications
opt into validation middleware on individual routes. See [validation](validation.md).

---

## 5. Typed Configuration

`@longhorn/config` merges supplied records and validates them through
`@longhorn/validation` using Standard Schema. It contains no runtime-specific imports.
Later defined keys take precedence, schema defaults and transformations produce typed
output, and the top-level result is frozen. Failed validation throws `ConfigError`
with normalized issues and a field-only summary suitable for startup diagnostics.

`@longhorn/node/config` snapshots process environment values and optionally reads `.env`
files using Node's native parser. Files merge in order; environment values win. It
does not mutate `process.env`. This separate entrypoint keeps file and environment
access in the runtime adapter. Node.js 20.19.0+ is the supported Node baseline.

The basic example validates configuration before app creation and server startup,
registers the result as an application-owned DI provider, and exits with status 1
when configuration fails. Core does not depend on configuration or a schema vendor.
See [configuration](configuration.md) for the API and precedence rules.

---

## 6. Lifecycle and Logging

Core owns a single application lifecycle. Startup hooks run before listeners or
portable Fetch dispatch; successful hooks can return resource cleanup callbacks.
Shutdown drains listeners, releases startup resources in reverse acquisition order,
and runs stop hooks. Failed startup rolls back acquired resources. Errors are
retained while cleanup continues. Process signals stay in the host entrypoint.
See [lifecycle](lifecycle.md).

`@longhorn/logger` supplies JSON-safe structured records, levels, child bindings,
redaction, and pluggable synchronous sinks. Its Hono entrypoint attaches a request
ID and child logger. Core connects HTTP errors to that logger and exposes typed
request context. The default core logger is silent; the example explicitly enables
logging from validated configuration. See [logging](logging.md).

The [feature index](features.md) is the documentation entrypoint. Every implemented
feature has a guide recording its ownership, connections, verification, and limits.
The [roadmap](roadmap.md) tracks remaining integrations and next milestones.

---

## 7. Database and Persistent Application Resources

`@longhorn/database` defines SQL values, statements, results, executors, transactions,
and async connection cleanup. It imports no native driver or runtime API. Its first
migration runner verifies ordered, checksummed migration history and applies pending
SQLite-compatible SQL and metadata in a write transaction.

`@longhorn/node/sqlite` implements the contract with the local `@libsql/client`
driver. File and native imports stay in that separate Node entrypoint. It enables
foreign keys, WAL, and full synchronization, coordinates operations across local
handles, and waits for accepted work before closing.

The tasks application acquires and migrates its database in lifecycle startup. DI
connects `TaskDatabase -> TasksStore -> TasksService`; HTTP handlers await the async
service contract. Normal shutdown and failed binds release the connection. Committed
task changes and generated IDs survive process restarts. Additional database providers
remain explicit integrations rather than implicit support; native PostgreSQL is described below.

See [database](database.md), [migrations](migrations.md), and [SQLite](sqlite.md).

---

## 8. Native Runtime Portability

`@longhorn/bun` and `@longhorn/deno` implement native listener adapters. Shared option
validation keeps defaults and port checks consistent across Node, Bun, and Deno.
Native type globals remain isolated in adapter type projects.

`@longhorn/workers` wraps contextual Fetch dispatch, forwarding bindings/context per
request without owning a socket or changing global environment state. Core starts
shared apps lazily; Workers owns isolate and background lifetimes. Node-native
storage/file adapters do not enter the Worker production graph.

`examples/portable` shares core, DI, validation, logging, and configuration across
hosts. Its browser Worker build rejects Node builtin imports. Actual local runtimes
verify transport, lifecycle, bindings, and background work. See [Bun](bun.md),
[Deno](deno.md), [Workers](workers.md), and [the portable example](portable-example.md).

---

## 9. Development CLI and Project Distribution

`@longhorn/cli` owns argument handling, project script delegation, and one staged
project generator. `create-longhorn` is a thin creation entrypoint over that API.
These are Node development tools, outside the runtime-neutral production packages.

The CLI build captures implemented framework exports and declarations after their
builds finish. Generation copies the selected runtime's transitive package graph
into the new project's `.longhorn/framework/`, with root pnpm overrides resolving
all internal dependencies to those local copies. Generated apps can install outside
the monorepo while LongHorn remains unpublished. This does not replace third-party
dependency installation or imply a published release.

Starter hosts own environment access and signals; shared app routes retain core,
Hono, DI, lifecycle, validation, and logging. Native dev commands watch source; the
Worker dev host rebuilds with esbuild and reloads workerd. Each starter includes
tests and individual feature guides. See [CLI](cli.md), [project generation](project-generation.md),
and [starter templates](starter-templates.md).

---

## 10. Credentials, Sessions, and Authorization

`@longhorn/auth` composes account, password, session, and login-attempt contracts.
Shared code creates opaque tokens with Web Crypto and stores only hashes. It owns
absolute session expiry, rotation, revocation, normalized username/password policy,
and account-based throttling. Core does not enable auth automatically.

`@longhorn/node/passwords` supplies bounded asynchronous native scrypt work.
`@longhorn/auth/sqlite` supplies account/session/attempt tables and atomic operations
over the SQL contract; application code composes its exported migrations with the
rest of the database history. Connection ownership stays with lifecycle hooks.

`@longhorn/auth/hono` supplies cookie/session middleware, exact source-origin checks
for unsafe methods, authenticated/role/asynchronous policy guards, and cookie
delivery helpers. A typed Hono subrouter composes its context with core's DI context.
Roles reload from storage per request. Application queries still enforce resource
ownership; authentication does not automatically filter data.

`examples/auth` proves these connections with native credentials, durable sessions,
and owner-scoped notes, independently of the existing tasks database. See
[authentication](authentication.md), [sessions](sessions.md), [passwords](passwords.md),
[HTTP auth](auth-http.md), [authorization](authorization.md), [auth SQLite](auth-sqlite.md),
and [the auth example](auth-example.md) for APIs, verification, and current limits.

---

## 11. Typed Events and Subscription Ownership

`@longhorn/events` owns symbol-identified typed definitions, ordered asynchronous
dispatch, aggregated listener failures, correlation metadata, and subscription
lifetimes. It imports no runtime, core, logger, database, or HTTP implementation.
Applications supply a bus through DI and register cleanup after the resources its
listeners use. Scopes and AbortSignal support feature-owned subscriptions.

Bus shutdown refuses new root work, drains accepted emissions and their context-
owned follow-ups, then removes subscriptions and closes scopes. Dispatch errors
remain with the emitter; draining is not a retry or a durable delivery guarantee.
See [events](events.md) and [subscription ownership](event-subscriptions.md).

The tasks service publishes after committed mutations. Its observers update bounded
process-local activity and log metadata; an observation failure preserves the already
successful write result. `/activity` exposes counts/latest correlation without titles.
Event cleanup precedes SQLite cleanup. Portable/generated apps also await echo events
and expose process/isolate observations at `/events`. See [task events](task-events.md).

---

## 12. Typed Caching and Derived Views

`@longhorn/cache` coordinates one typed value schema over an exclusively owned
store. It distinguishes misses from cached undefined, shares concurrent loading,
copies values, and fences older flights after delete/clear/set. Per-key store queues
and a clear barrier order provider I/O without serializing independent backend loads.
Errors remain explicit, and cleanup drains accepted work before closing the store.

`@longhorn/cache/memory` supplies bounded LRU storage with lazy TTL expiry and no
background timers/native API. Cache/store ownership is per process or isolate;
distributed providers and invalidation protocols remain future integrations.

The tasks app caches only its derived `/summary` view. Local committed mutations
invalidate directly, independently of observational events. Other processes' writes
follow TTL, while original task list/detail reads remain uncached. Provider failure
causes an explicit service-level bypass, preserving committed write results. Resource
acquisition is database, cache, then events; cleanup reverses that order.

Portable/generated apps demonstrate a public runtime profile at `/cached` and local
invalidation. Request-specific bindings and credentials do not enter its value.
See [cache](cache.md), [memory storage](memory-cache.md), and
[task summaries](task-cache.md) for contracts, tests, consistency, and lifecycle.

---

## 13. Durable Jobs and Background Workers

`@longhorn/queue` coordinates a versioned queue name and Standard Schema JSON
payload over an atomic QueueStore. It separates metadata from stored data/tokens,
supports delay/retry budgets, renews running leases, and conditionally acknowledges
using the current claim token. Expired attempts recover on the next claim, and
exhausted crashed attempts become failed. Effects remain at-least-once.

`QueueWorker` supplies explicit host-owned polling/concurrency and graceful drain.
The memory entrypoint is a process-local reference provider; the SQLite entrypoint
uses the portable database boundary and write transactions for cross-process claims.
The database is borrowed, with composed migrations and cleanup owned by the app.
Workers isolates can execute bounded calls with an appropriate provider/lifetime;
there is no durable Cloudflare queue integration or perpetual isolate poller here.

`examples/jobs` enqueues reports over HTTP and persists results idempotently by job ID.
Its queue/worker resources are also shared with the scheduler described below;
the full acquisition order is DB -> queue -> scheduler -> worker -> timing runner,
with HTTP -> runner -> worker -> scheduler -> queue -> DB cleanup.
Separate-process verification covers concurrent ownership, retries, SIGKILL recovery,
lease renewal, and restart. Business-write outbox coupling, retention/admin APIs,
additional providers are later work. See [queues](queues.md),
[workers](queue-workers.md), [SQLite storage](queue-sqlite.md), and
[report jobs](jobs-example.md) for APIs, connections, tests, and limits.

---

## 14. Durable Scheduling and Queue Dispatch

`@longhorn/scheduler` persists one-time, fixed-interval and numeric five-field UTC
cron definitions, with stable identities, explicit latest/catch-up missed policies,
bounded dispatch batches and cancellation. Queue.prepare supplies typed, validated
JSON snapshots. Durable state belongs to the provider rather than the host's timer.

The SQLite entrypoint atomically inserts each queue occurrence and advances its
cursor in one write transaction. Two same-file processes can poll concurrently;
writer serialization prevents duplicate committed occurrences. A kill between
insertion and cursor update rolls both back. Queue handlers still need idempotent
effects, since execution remains at-least-once. The paired memory backend supports
portable transient tests without a durability claim.

SchedulerRunner owns a serial host timer; Fetch platforms can call bounded ticks
through an appropriate trigger/provider. The report app adds registration/status/
cancellation routes, appends the scheduler migration after its deployed prefix,
and stops timing before queue workers during cleanup. Tests execute native runtimes,
multi-process dispatch, a killed open transaction, and HTTP restart/cancellation.
See [schedules](scheduler.md), [cron](cron.md), [timing hosts](scheduler-runner.md),
[SQLite dispatch](scheduler-sqlite.md) and [scheduled reports](scheduled-reports.md).

---

## 15. Portable Observability

`@longhorn/observability` separates explicit Readiness checks, a structural Meter
interface/bounded registry, and TraceProvider/Tracer/exporter contracts. The root
has no HTTP, Node or backend SDK import. Separate Hono, Prometheus-text and memory
export entrypoints keep adapters opt-in. Core does not acquire a telemetry dependency.

Readiness coalesces active probes, limits response waiting, signals cancellation,
and retains a busy slot until underlying work settles. Closing readiness drains
dependencies before they are released. Liveness is a separate application predicate.
Metrics fix label names and bound series; HTTP labels use registered route templates,
never raw dynamic paths or request payloads. Tracing passes context explicitly,
validates traceparent, bounds active/queued work, serializes best-effort export, and
drains recording spans before exporter close. No implicit async context or collector
wire protocol is installed. Provider failures do not replace business results.

The report app checks SQL and enabled background services, exposes process-local
metrics/spans/diagnostics, links request/enqueue spans, and observes worker attempts
as independent trace roots. Cleanup drains HTTP/readiness, background resources,
SQL, then final tracing/metrics. A pre-close unready grace period is host policy.
Portable/generated apps supply the same surfaces with a state-only check. Native
tests include all runtime targets, dependency failure/recovery, stuck checks,
bounded private data handling, exporter failure and signal-driven shutdown.
See [observability](observability.md), [health](health-checks.md), [metrics](metrics.md),
[tracing](tracing.md), [HTTP telemetry](http-telemetry.md), and
[report diagnostics](jobs-observability.md).

---

## 16. Native PostgreSQL and Explicit Dialects

The SQL contract now accepts boolean values and optionally identifies sqlite or
postgres dialects. SQLite maps boolean binds to integer values; PostgreSQL retains
booleans and preserves bigint/exact numeric/JSON/time values without lossy object
conversion. Native SQL/parameters remain the provider's responsibility. Shared core
does not import pg; @longhorn/node/postgres owns its pool/socket/TLS entrypoint.

The PostgreSQL adapter bounds pool and admitted work, leases one connection per
callback transaction, drains statements before commit/rollback, rejects reentrancy,
and resets session state before returning connections. Query/control errors and
uncertain commit/cleanup outcomes remain explicit; no automatic retry is installed.
The separate migration entrypoint owns one checksummed history per namespace and
takes a transaction advisory lock before initial schema/metadata creation.

The new example deploys with a migration owner and serves public cursor tasks with
a restricted nonsuperuser role. A native temporary demo is available without using
normal database services. Verification covers actual PostgreSQL 18.4, connection
termination, transaction errors, scalar precision, privilege restrictions, concurrent
migrators/writers, SIGKILL recovery, HTTP restarts and pool cleanup. SQLite-specific
auth/queue/scheduler providers are not automatically portable to this backend.
See [provider](postgres.md), [transactions](postgres-transactions.md),
[migrations](postgres-migrations.md), [roles](postgres-roles.md),
[app](postgres-example.md), [pages](postgres-pagination.md), and [local QA](postgres-local.md).

## 17. PostgreSQL Background Work

The isolated @longhorn/queue/postgres and @longhorn/scheduler/postgres entrypoints
borrow the Database contract and import no native driver. PostgreSQL uses constrained
bigint millisecond state, partial due/expiry indexes and row locks with SKIP LOCKED.
Queue claims recover bounded expired batches, assign tokens atomically, and release
locks before effects. Conditional acknowledgement/renewal fences stale owners.

Schedule registration preserves immutable definitions/cursors. A dispatch transaction
locks each due cursor, inserts its stable queue occurrence and advances the cursor;
failure rolls back the whole tick. Cancellation waits for an already-owned cursor,
retains committed jobs, then stops future dispatch. Multiple timing hosts share this
protocol without a timer leader. Effect execution remains at-least-once.

The PostgreSQL tasks app deploys appended migrations under its owner role, then runs
restricted report producers/workers/timing hosts through DI/lifecycle. One SQL effect
counts tasks and inserts a report keyed by job ID; retries preserve that first result.
Native tests include competing pools/processes, renewals, crash/recovery before and
after effects, atomic schedule rollback, restricted grants and HTTP restart.
See [queues](queue-postgres.md), [schedules](scheduler-postgres.md),
[reports](postgres-reports.md), and [native proofs](postgres-background-testing.md).

## 18. PostgreSQL Accounts and Private Data

The @longhorn/auth/postgres entrypoint supplies CredentialStore, SessionStore and
LoginAttemptStore through the existing AuthStore contract. It imports no native
driver or HTTP implementation. Fixed schemas use normalized unique handles, JSONB
roles, constrained hash-only sessions, foreign keys and indexed expiry/user paths.
One key upsert serializes throttle reservations; explicit bounded cleanup handles
expired distinct windows. Session replacement inserts/revokes on one transaction.

AuthService, Web Crypto token generation, native password hashing and cookie/origin
policy remain above storage. The example mounts those guards under /account, leaving
public tasks/reports separate. Private note operations always bind the principal's
owner ID. This is application-enforced ownership; PostgreSQL RLS is not implied.
Runtime has only required table/sequence privileges and no account mutation/DDL grant.

One authoritative migrations.ts list preserves the deployed example prefix and appends
auth/private-note resources. Account configuration resolves before listening; failed
startup releases the pool and admitted HTTP drains before shutdown. Native proofs
cover actual scrypt, competing accounts/counters, live roles, private data, session
expiry/revocation/restart and SIGKILL after replacement writes before commit.
See [credentials](auth-postgres.md), [sessions](postgres-sessions.md),
[attempts](postgres-login-attempts.md), [accounts](postgres-accounts.md),
[notes](postgres-private-notes.md), and [verification](postgres-auth-testing.md).

## 19. OTLP/HTTP Collector Delivery

The @longhorn/observability/otlp entrypoint implements the existing SpanExporter
boundary using Web Standard Fetch and JSON. Core/root tracing imports no transport.
Tracer still owns bounded recording/queue/batching and exclusive exporter lifetime;
the transport admits one batch, snapshots bytes and bounds HTTP attempts, total
deadline, retry waits and response reading. Partial acceptance is never replayed.

Wire records preserve hex context, numeric enums, scalar AnyValues and decimal
nanosecond strings derived without unsafe epoch multiplication. Resource identity
and headers are explicit; safe diagnostics omit endpoints, credentials and collector
messages. Host configuration opts the jobs app into remote HTTP/producer/consumer
spans while memory mode remains the default. Collector failure does not replace
business results or dependency readiness; final Tracer.close drains delivery.

Pinned native collector tooling lives outside production packages. Built Node/Bun/
Deno/workerd fixtures roundtrip through its real JSON receiver/exporter pipeline;
controlled faults verify policy and a compiled report host proves persisted work,
privacy, outage isolation and shutdown. The temporary demo supports startup
cancellation and drains the app before releasing its owned collector/data.
See [transport](otlp-http.md), [mapping](otlp-json.md), [delivery](otlp-delivery.md),
[configuration](otlp-configuration.md), [reports](jobs-otlp.md) and [proofs](otlp-native.md).

## 20. Managed Work and Workers Scheduled Events

Core exposes app.run(callback) through the portable TaskApplication contract.
It shares startup with Fetch/listen, preserves values/errors and owns the actual
callback until settlement. Shutdown drains HTTP and managed work before releasing
resources. No synthetic request, implicit context or runtime import is required.

The isolated @longhorn/workers/scheduled entrypoint borrows that capability and
retains the existing Fetch adapter. Each scheduled invocation forwards the original
controller, bindings and execution context; one completion Promise is registered
with waitUntil before user/startup work and returned to the platform. Instance-local
admission bounds accepted events, including startup waiting. A cooperative signal
budget never abandons the real callback, its slot or resources. Scheduled close
drains only that adapter; application/Fetch shutdown remains host-owned.

The audit example creates one invocation-owned paired memory scheduler/queue,
dispatches one stable-ID occurrence, writes same-value replay-safe KV effects,
closes its local coordinators and awaits explicit consumer tracing. KV effects
are external; queue/cursor state is transient and the two KV writes are not atomic.
The adapter supplies no durable provider, automatic retry, cron deployment or
isolate-eviction guarantee. Generated Workers starters consume the same export
with isolate-local observations and their own connection guides.

Native workerd tests prove platform dispatch, capacity, errors/noRetry, telemetry
drain, cooperative/ignored abort and concurrent core/adapter resource close. They
also replay into a fresh isolate with persisted test KV, exercise the standalone
launcher, and verify the independently installed generated starter.
See [managed work](application-work.md), [adapter](workers-scheduled.md),
[admission](scheduled-invocations.md), [example](workers-scheduled-example.md),
[telemetry](scheduled-telemetry.md) and [native proofs](workers-scheduled-testing.md).

## 21. Durable Object SQLite and Bounded Report Processing

The @longhorn/workers/durable-sqlite entrypoint adapts a SQLite-backed Object's
storage to Database without a Node driver. Root operations share a per-storage
serial gate with bounded admission. Native async transactions own callback SQL;
the Object input gate prevents other events from entering an unfinished operation.
Ordinary failures are caught inside that gate before being rethrown, preserving
rollback/original errors without turning every rejected query into an Object reset.
The callback executor expires on settlement; close drains accepted work and syncs
writes while the platform retains storage ownership.

The platform SQL API returns JavaScript numbers. The provider rejects non-finite
and unsafe integer inputs/results, accepts only safe bigint binds and copies BLOBs.
Conversion is inside the native transaction so a failed returned-value conversion
cannot accidentally acknowledge a committed write. It consumes cursors before any
yield and retains native direct-change/last-row metadata. Cross-Object transactions,
D1 callback emulation and arbitrary int64 precision are not implied.

The existing migration/SQLite queue/scheduler implementations run over this
boundary. A named Object owns one complete schema history and one app/DI/lifecycle.
Its report app persists jobs, definitions/cursors and idempotent result rows; an
outer scheduled Worker awaits a bounded Object tick/process response. Persistent
state and the wakeup mechanism remain distinct. There is no always-running isolate
poller, automatic alarm/broker binding or deployment. Local tooling supplies a
persistent SQLite namespace; deployment class migrations remain application-owned.

Native workerd proves SQL/DDL rollback, exactness guards, capacity/close, competing
claims and lease fencing, atomic dispatch/cancel, actual Object abort between job
and cursor writes, full-host restart, scheduled report processing and launcher
shutdown. See [provider](workers-durable-sqlite.md),
[ownership](durable-sqlite-transactions.md), [schema history](durable-sqlite-migrations.md),
[queues](workers-durable-queues.md), [scheduling](workers-durable-scheduler.md),
[example](workers-durable-example.md) and [native proofs](workers-durable-testing.md).

## 22. Platform Queue Events and Explicit Message Decisions

The @longhorn/workers/queue entrypoint adapts native broker batches to TaskApplication
while preserving contextual Fetch. One registered/returned completion Promise owns
shared startup, a bounded per-batch message pool and an optional awaited afterBatch
hook. Original batch/message/bindings/context objects remain platform-owned; only
the admitted array membership is copied. No synthetic HTTP request is created.

Handlers receive unknown payloads and return explicit ack/retry decisions. The
adapter validates those decisions and invokes original native methods with their
receiver. It continues other messages after failure, then reports ordered original
errors as a batch aggregate. No SQL lease protocol, automatic default ack, retry
timer or batch-wide decision is installed. Broker attempts/limits/DLQ configuration
remain platform/application policy. Earlier explicit decisions cannot be undone
by a later message or telemetry rejection.

Admission bounds batches/messages per instance. Cooperative abort stops unstarted
messages and prevents late automatic decisions; actual handlers/export still retain
their slot and resources until settlement. Adapter close drains queue work only;
core drains managed callbacks before releasing resources. Safe stats contain no
payloads, message IDs, bindings or retained errors. Module-scoped explicit consumer
tracing flushes through the awaited hook without promising termination-time export.

The new example publishes validated HTTP input through an actual local broker,
consumes it automatically and preserves first results by a business key in Object
SQL. It does not duplicate broker state into LongHorn queue tables. Native workerd
tests inspect partial ack/retry/error flags separately from actual local broker
redelivery and dead-letter tests: the pinned Miniflare broker ignores explicitAcks
when retrying a failed batch, a documented emulator limitation. Other proofs cover
bounded I/O, export/abort/close drain, persisted receipt restart and launcher disposal.
See [adapter](workers-queue-events.md), [decisions](queue-message-decisions.md),
[lifetime](queue-batch-lifecycle.md), [telemetry](queue-consumer-telemetry.md),
[example](queue-worker-example.md) and [native proofs](workers-queue-testing.md).

## 23. Durable Object Alarm Projection and Recovery

The @longhorn/workers/sqlite-alarms entrypoint owns one alarm for configured queues
inside one Object. It follows active schedule cursors, pending availability and
running lease expiry. Starting it after complete migrations installs an internal
per-storage commit extension in the existing Object SQL provider. Every successful
root operation, including another handle's, projects SQL state and native alarm
changes in the same storage transaction. A hook/alarm failure rolls both back;
unconfigured providers retain their default behavior.

A small appended migration stores one Object-wide retry floor. Failed/timed-out
processing persists backoff with the next projection. Native alarm entry returns
an app.run-owned Promise covering startup, bounded callback work, telemetry and
recovery. Duplicate manual calls coalesce. Cooperative abort does not abandon the
actual callback; close drains entered work without deadlocking startup rollback.
Readers do not continually slide an already adequate near wakeup forward.

The automatic report entrypoint reuses the existing app/DI/schema prefix and
bounded processing helper, appending only alarm metadata. It has no Cron Trigger
or perpetual isolate poller. One startup activation plus a changed-time refresh
restores the pinned standalone runtime's cold alarm index; this local bootstrap is
distinct from managed cloud discovery. Native Object reset before a due alarm needs
no HTTP kick, and interruption after effect commit recovers the lease with one
idempotent result. Native tests also chain bounded backlog alarms and retain SQL
state across full-host restart. Application deployment and external effects retain
their explicit guarantees; exactly-once execution is not inferred.
See [host](workers-sqlite-alarms.md), [planning](alarm-wakeup-planning.md),
[schema](alarm-migrations.md), [recovery](alarm-recovery.md),
[example](alarm-report-example.md), [telemetry](alarm-telemetry.md) and
[native proofs](workers-alarm-testing.md).

## 24. Managed Transactions and Typed Job Publishing

The @longhorn/database/transactions entrypoint registers immutable executor
capabilities for an exact database owner without changing the SqlExecutor callback
shape. Public callback executors expire at callback completion. Accepted transaction
participants retain separate checked executors while providers drain preparation/
SQL before commit; their executors expire on settlement. Abort prevents later
participant writes and joins actual work before rollback. Accepted publication
failure rejects completion even if caught, preserving original failure values.

The @longhorn/queue/transaction entrypoint reuses Queue schema/JSON/size/attempt/
delay coordination through an internal admission bridge. SQLite/PostgreSQL stores
opt in with an ownership-checked insertion capability. Root/cloned/expired/foreign
executors and unsupported stores cannot silently fall back to independent enqueue.
The helper neither opens nor commits a transaction; provisional JobInfo becomes a
durable producer outcome only with the caller's outer commit. No schema or queue
payload changes are introduced. Ordinary queue producers keep their existing path.

Node SQLite and PostgreSQL integrate scope completion before native commit/drain.
Object SQL integrates it before its optional alarm projection, making business row,
job and wakeup one commit. The PostgreSQL task app exposes an explicit create-task/
report route using its existing restricted roles and schema. A failed job publish
rolls back the task; later workers process the committed follow-up after restart.

Native proofs use independent visibility observers, concurrent producers and
SIGKILL before/after commit on real SQLite/PostgreSQL. Object tests interrupt after
alarm writes, drain asynchronous publication after callback return and let an
actual alarm consume the committed business row. Request idempotency and external
broker outbox delivery remain separate guarantees. See [API](transaction-publishing.md),
[executors](transaction-executors.md), [SQLite](sqlite-transaction-publishing.md),
[PostgreSQL](postgres-transaction-publishing.md), [Object SQL](object-transaction-publishing.md),
[HTTP](task-report-transactions.md) and [native proof](transaction-publishing-testing.md).

## 25. Durable Request Idempotency

`@longhorn/idempotency` composes the Database transaction contract with bounded
JSON input fingerprints and saved JSON results. Server-derived scope plus client
key identifies an operation. Explicit SQLite/PostgreSQL stores take native UPSERT
ownership before checking expiry/fingerprint, then execute business writes and
validated job publishing through the managed callback executor. Request metadata,
business state and jobs commit together; Object SQL also projects the alarm in
that commit. Shared sources use Web Crypto and import no runtime driver or HTTP.

Matching unexpired requests replay the historical result; changed input conflicts.
Expired keys can execute a new generation. Retention starts at callback completion
and is not renewed on replay. Cleanup is an explicit bounded store operation;
PostgreSQL skips active row owners and SQLite serializes with its writer. The
service creates no timer and borrows database lifetime. External effects remain
represented by idempotent jobs; the ledger does not provide cross-system atomicity.

The PostgreSQL task/report route accepts an optional key and normalizes the title
before fingerprinting. Its owner history appends ledger storage; startup/readiness
and restricted runtime grants cover the new resource. Two native HTTP hosts and
process SIGKILL checks prove replay across ambiguous response windows. Actual
Object resets before/after commit prove rollback versus retained result, followed
by native alarm consumption. CLI archives include the package and its declarations.

See [API](idempotency.md), [JSON](idempotency-json.md), [storage/retention](idempotency-storage.md),
[SQLite](idempotency-sqlite.md), [PostgreSQL](idempotency-postgres.md),
[Object SQL](idempotency-workers.md), [HTTP](idempotency-http.md) and
[verification](idempotency-testing.md).

## 26. Transactional Outgoing Broker Messages

`@longhorn/outbox` composes the existing Queue transaction, schema, lease, retry
and worker engine under a dedicated prefixed queue. Explicit SQLite/PostgreSQL
stores add bounded terminal cleanup and an index without duplicating job tables
or native claim logic. Business/request/outgoing writes share the managed caller
transaction; publisher calls occur only after committed claims. The publisher port
carries a stable application ID across attempts and resolves after remote acceptance.
Local acknowledgement remains a separate fenced SQL transition, allowing duplicate
publication after interruption. Consumers own atomic deduplication with their effects.

The optional Workers adapter bridges a native queue binding to the structural port
and awaits its actual promise, including after cooperative cancellation. It imports
no application/Outbox implementation. The automatic example connects DI, request
replay, Object SQL and its alarm host to a broker and a separate receipt Object.
Producer/consumer traces flush within owned invocations. Native hosts can instead
own QueueWorker dispatchers; platform hosts dispatch bounded batches.

Retention is explicit, bounded and terminal-only. PostgreSQL delivery needs existing
queue DML; the example runtime retains DELETE denial and separate maintenance
credentials prune. Native tests interrupt actual producer/dispatcher processes and
Object alarms before commit and after broker acceptance. Distinct transport delivery
IDs retain one stable envelope ID and one SQL effect. Local launch/restart and CLI
archive checks verify the runnable path. Failed-record inspection/redelivery is
implemented in the optional recovery capability below. See [API](outbox.md), [dispatcher](outbox-dispatcher.md),
[SQLite](outbox-sqlite.md), [PostgreSQL](outbox-postgres.md), [retention](outbox-retention.md),
[publisher](workers-outbox-publisher.md), [consumer IDs](outbox-consumer-deduplication.md),
[example](outbox-worker-example.md) and [verification](outbox-testing.md).

## 27. Outgoing Inspection and Deliberate Recovery

Outbox's optional recovery capability adds explicit metadata projection and bounded
queue/state keyset pages. Both built-in stores use the same job table and native
conditional UPDATE. Only failed records matching the caller's observed attempt
ceiling can return to pending. The ceiling strictly increases up to 100, lifetime
attempts remain cumulative and message identity/payload are unchanged. This prevents
stale actions from matching a later failure even with identical timestamps.

Separate index migrations append after complete deployed histories, preserving the
command example's old prefix. Existing PostgreSQL SELECT/UPDATE grants suffice;
maintenance DELETE remains separate. Retry and pruning have atomic retained-pending
or deleted/missing outcomes. Existing lease tokens fence old publishers, and Object
SQL composes retry state/budget with its native alarm projection before commit.

The example optionally exposes strict operations routes through a deployment bearer
capability. Without configuration those routes are absent. The library owns no
authentication; applications choose operator/tenant policy. Native tests prove
upgrade, process SIGKILL, competing actions, cleanup races, alarm-abort rollback,
opaque HTTP cursors and real stable-ID broker redelivery with one receipt. The
optional audit capability below records application-derived attribution/history.
See [inspection](outbox-inspection.md),
[retry](outbox-deliberate-retry.md), [concurrency](outbox-recovery-concurrency.md),
[migrations](outbox-recovery-migrations.md), [HTTP](outbox-operations-http.md),
[authorization](outbox-operations-authorization.md) and [verification](outbox-recovery-testing.md).

## 28. Durable Recovery Audit

The optional OutboxAuditStore capability composes the existing conditional retry
through the caller-owned native transaction executor with one action/result append.
Source validation requires trusted actor/reason identifiers. Valid scheduled,
conflict, budget-exhausted and missing actions receive distinct server audit IDs;
invalid input or database failure leaves no committed event. An append failure
rolls back a pending transition. Object SQL includes its native alarm projection
in that commit, preserving the original broker message identity on later delivery.

Separate audit migrations append a dedicated table and global/per-delivery history
indexes after deployed prefixes. No delivery foreign key makes history independent
of job pruning and permits missing-target events. PostgreSQL runtime uses queue
DML plus audit SELECT/INSERT; normal audit UPDATE/DELETE stay denied. Dedicated
maintenance can prune with only audit SELECT/DELETE and schema usage. History and
retention use bounded queue-scoped queries and Outbox close admission/drain.

The Worker operations route now chooses the audited path, takes its actor label
from a server service binding and validates reason codes. It exposes protected
history with context-bound cursors; client actor claims are rejected. A shared
capability identifies a service credential holder, not a human. Native tests prove
process/Object rollback and retained commit, append denial, concurrency, legacy
upgrade, stable-ID broker effects, independent cleanup and credential/actor rotation.
The trail is durable application metadata rather than a tamper-proof database-owner
boundary. See [API](outbox-audit.md), [storage](outbox-audit-storage.md),
[attribution](outbox-audit-attribution.md), [history](outbox-audit-history.md),
[retention](outbox-audit-retention.md), [atomicity](outbox-audit-atomicity.md),
[HTTP](outbox-audit-http.md) and [verification](outbox-audit-testing.md).

## 29. Account Authorization for Operations

The optional TransactionalAuthStore capability joins a current principal to an
exact managed database transaction. SQLite write ownership and a PostgreSQL
narrow lock function retain session/user ownership until protected mutations
commit. The PostgreSQL function has fixed search_path, nonsuperuser owner,
PUBLIC execution revoked and no password projection, preserving the runtime's
user UPDATE denial. Expiry is checked after waiting for locks. Ordinary request
authentication still supplies admission snapshots for reads.

OutboxAuthorizedStore calls application policy before its existing recovery/audit
writes in that same transaction. The optional Hono adapter centralizes strict
metadata/history/retry routes while leaving identity, roles and queue scope to
the host. Service bearer and account cookie policies share it. Account retries
bind admission and transaction identities; audit attribution comes from verified
user IDs. Trusted role changes and existing-session deletion commit together;
there is no public role-management endpoint.

The optional PostgreSQL operations profile connects the same DI database to Auth,
Idempotency and Outbox. Members create owner-scoped commands; numbers-operator
accounts inspect/recover one fixed application queue. A lifecycle-owned dispatcher
publishes the existing versioned envelope to a host-supplied broker. The runnable
demo connects the actual Worker consumer and protected receipt reader. Native
process locks, interruption, restricted grants and Object rollback are verified.
See [auth](transaction-authentication.md), [PostgreSQL](postgres-transaction-auth.md),
[retry](outbox-authorized-retry.md), [HTTP](outbox-hono.md),
[application](account-operations.md), [provisioning](operator-provisioning.md),
[demo](operator-accounts-demo.md) and [verification](operator-accounts-testing.md).

## 30. Persistent Operator Hosting and HTTP Delivery

The optional HTTP client entry has explicit same-base URLs/credentials, bounded
JSON/bytes/concurrency and cancellation ownership. It imports neither Hono nor
Node. HTTP Outbox publishing uses it outside business transactions and accepts
only a synchronous matching acknowledgement. The existing dispatcher owns
retries, leases and actual transport drain. Bearer capability verification is
shared with the existing service operations guard; individual account identity
remains a separate cookie/session policy.

A dedicated Worker receiver validates the versioned envelope, computes the
existing numbers effect and awaits Object SQL storage before acknowledging.
ReceiptStore atomically dedupes identical command/results and rejects conflicting
effects under one stable message ID, preserving its original deployed schema.
The retained local receiver host exposes only protected routes. The existing
broker/public demo executable remains separate.

The persistent PostgreSQL operator executable consumes an explicit runtime-only
configuration. It rejects provisioning/maintenance authority, deploys no schema
and never owns the user's database service. The same account app/DI/lifecycle
composes its dispatcher with protected remote receipt/health clients. Dependency
outage affects readiness and delivery attempts; user-scoped commands and audit
remain durable. Restart reclaims expired leases without resetting identity or
attempt budgets. Native tests interrupt after receiver commit but before the
publisher acknowledgement, then prove repeated delivery retains one effect and
both hosts preserve commands/receipts/audits across restart.

See [JSON transport](service-json-client.md), [capabilities](bearer-capabilities.md),
[publisher](outbox-http-publisher.md), [receipt conflicts](receipt-deduplication-conflicts.md),
[receiver](http-message-receiver.md), [configuration](operator-host-configuration.md),
[remote receipts](operator-receipt-transport.md), [host](persistent-operator-host.md)
and [verification](persistent-operations-testing.md).

## 31. Command History and Browser Application

The account command repository persists an immutable int64 history position,
creation time and delivery association in the existing business transaction.
Owner-scoped keyset pages project only safe outgoing metadata; operator all-scope
is explicit. Cursor context supplements server authorization. Legacy migration
retains every command and associates only unambiguous retained outgoing records.
History remains readable when independently retained delivery metadata disappears.
See [API](account-command-history.md), [upgrade](command-history-migrations.md),
[pagination](command-history-cursors.md) and [proof](command-history-testing.md).

The same optional PostgreSQL app now serves fixed built browser assets alongside
its existing APIs. Public shell/CSP carries no deployment secrets; private data
comes from account-guarded relative requests. Hash routing, read cancellation and
render generations prevent stale reads replacing another screen. An unchanged
submission retains its idempotency key after ambiguous failure. Operator recovery
uses the displayed allowance and requires refresh after conflict; actor identity
remains server-derived and transaction-locked. Native Chromium exercises actual
PostgreSQL, scrypt, broker and receipt effects with responsive/accessibility
captures. See [console](web-console.md), [security](console-security.md),
[recovery](console-recovery.md), [proof](console-testing.md) and the
[complete application walkthrough](command-application.md).

## 32. Independent Distribution and Retained-State Verification

The complete command application is packaged from the existing editable source,
receiver and compiled framework dependency closure. Local file overrides keep
unpublished framework packages inside the archive. Atomic staged generation
refuses occupied/symlink destinations. The standalone build emits Node hosts,
browser assets and a bundled workerd receiver; setup separates migration/role
authority from the runtime profile. Trusted runtime grants add only named resources
in one transaction. Startup rejects effective administrative, CREATE, SET ROLE,
user-mutation and audit-mutation authority.

The maintenance tool makes an explicitly offline checkpoint of PostgreSQL and
stopped receiver storage. Hashes validate accidental corruption. Restore uses
fresh targets, preserves the complete schema/identity/migration history, omits
deployment-specific owner/ACL state and revokes default PUBLIC auth-function
execution before restricted regrants. No cross-system atomic restore or online
snapshot is promised. Native verification relocates/installs the actual archive,
uses its shipped tools/hosts, recovers an outage and restores retained state into
a second deployment before proving a new computed command.

CI configuration repeats source/native/browser/distribution gates with pinned
tooling and no deployment credentials. Hosted execution is pending the source
review branch in the connected private repository; runtime/platform evidence is documented per profile. See
[distribution](command-app-distribution.md), [grants](runtime-role-grants.md),
[deployment](command-app-deployment.md), [restore](command-app-backup.md),
[proof](command-app-testing.md), [upgrades](command-app-upgrades.md),
[CI](release-verification.md) and [matrix](supported-runtimes.md).

The command archive now includes its own resolved pnpm dependency lock with a
recorded hash and pinned package-manager identity. Packaging resolves only that
staged graph with hooks disabled; recipient frozen installation retains its bytes.
Native CI-mode installation after relocation rejects manifest drift before the
real application/restore workflow. See [locked dependencies](command-app-dependencies.md).
