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
│   ├── ratelimit/         # Explicit per-subject budgets and storage adapters
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
│   └── rust/              # Optional Rust report service (not a JS runtime adapter)
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
4. **Rust / Native Boundary**: Optional native services live under `native/rust/`. They connect through explicit portable protocols and are not JS runtime adapters.

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

`@longhorn/node/passwords`, `@longhorn/bun/passwords` and `@longhorn/deno/passwords`
supply bounded asynchronous native scrypt through `@longhorn/auth/scrypt` policy.
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

All three native hosts now compose the same auth app and retained schema; details
and bounded private-note reads are recorded in [section 47](#47-native-password-policy-and-retained-authentication).

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
background timers/native API. Cache/store ownership is per process or isolate.
The optional Redis adapter below shares retained values while coordinator load
fences remain local; stronger distributed invalidation needs its own protocol.

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
tooling and no deployment credentials. The tracked source review branch has a
draft PR in the connected private repository; current hosted checks and job logs
provide revision-specific evidence. Runtime/platform evidence is documented per profile. See
[distribution](command-app-distribution.md), [grants](runtime-role-grants.md),
[deployment](command-app-deployment.md), [restore](command-app-backup.md),
[proof](command-app-testing.md), [upgrades](command-app-upgrades.md),
[CI](release-verification.md) and [matrix](supported-runtimes.md).

The command archive now includes its own resolved pnpm dependency lock with a
recorded hash and pinned package-manager identity. Packaging resolves only that
staged graph with hooks disabled; recipient frozen installation retains its bytes.
Native CI-mode installation after relocation rejects manifest drift before the
real application/restore workflow. See [locked dependencies](command-app-dependencies.md).
Hosted browser/distribution jobs retain only their explicit review outputs under
run-specific artifact names: captures/accessibility results and the archive plus
checksum after successful native verification. See [CI artifacts](ci-review-artifacts.md).

---

## 33. Redis Cache Storage and Explicit Serialization

`@longhorn/cache/redis` implements the existing CacheStore contract over a portable,
exclusively owned command client. Namespaces isolate keys and bounded SCAN/UNLINK
clear. Redis 7+ Lua keeps value/absolute expiry together and rejects expiry overflow
before replacement. `@longhorn/cache/json` adds a versioned bounded envelope and
application-supplied synchronous/asynchronous schema validation; memory storage
retains its existing copy behavior without acquiring a serialization requirement.

`@longhorn/node/redis` owns actual authenticated TCP/TLS. Native deadlines destroy
the connection, admission is bounded, and offline queues/reconnect/replay are
disabled. Close drains accepted work before releasing the transport. A timeout
cannot roll back a server effect committed before acknowledgement loss.

The separate task host acquires SQLite, the selected cache store and event observers
through the existing DI/lifecycle architecture. Cache failure explicitly bypasses
derived summaries while committed writes and direct task reads keep SQLite authority.
Retained values are shared across hosts; load fences are not distributed, so TTL
and trusted invalidation remain application policy. See [provider](redis-cache.md),
[codec](cache-json-codec.md), [transport](redis-node.md), [example](redis-tasks-example.md)
and [native verification](redis-cache-testing.md).

---

## 34. Cumulative Metric Export and Reader Ownership

The existing MetricRegistry now collects a detached snapshot with one cumulative
start identity and a collection timestamp. Counter/gauge/histogram recording and
Prometheus output keep their current contracts. `MetricSource` / `MetricExporter`
are portable structural interfaces; core imports no exporter or timer.

An explicitly started PeriodicMetricReader owns collection timing and one exporter.
It splits by point count, sends batches serially and coalesces demand during active
I/O into a fresh collection. Close stops admission/timers and includes final values
before releasing the exporter. Source totals are not reset by export or failure.

`@longhorn/observability/otlp-metrics` maps monotonic counters, signed gauges and
cumulative histogram buckets into bounded OTLP/HTTP JSON. Traces/metrics share one
delivery implementation while acknowledgements/errors retain their signal counts.
The reports app opts into metrics independently of traces, refreshes background
gauges without scraping and isolates collector failure from persisted business work
and readiness. The owned demo and native collector prove all four runtime profiles,
outage/recovery, actual Fetch cancellation and final export. See [reader](metric-reader.md),
[metric transport](otlp-metrics.md), [mapping](otlp-metrics-json.md),
[reports](jobs-metrics-export.md) and [native proof](otlp-metrics-testing.md).

---

## 35. Synchronous Logging and Owned Remote Delivery

`@longhorn/logger` keeps its existing synchronous record, redaction and console
behavior. Explicit fanout composes readonly normalized records across isolated
sinks. Observability consumes the logger's record type, preserving a one-way
dependency: the logger/core never import an exporter. A BufferedLogProcessor
snapshots entries and observed time, bounds count/normalized bytes including active
work, serializes asynchronous export and drops newest overflow without blocking
business work. It owns final drain and one exporter; no disk spool is implied.

`@longhorn/observability/otlp-logs` encodes severity, event/observed nanoseconds,
recursive AnyValue attributes and explicit span context. The existing HTTP engine
adds log-specific partial acknowledgements while keeping bounded retries, byte
limits, native cancellation and sanitized errors. A lost reply cannot establish
that a collector never accepted a record; telemetry delivery is best effort.

The reports host independently selects logs, keeps local console output and
projects known metadata remotely. Its context matches actual server spans and
its export failures report only locally. Final processor close runs after all
application/diagnostics hooks, including the Application stopped record. Native
collector proofs cover four runtimes, overload and real report work through an
outage. See [sinks](logger-sinks.md), [processor](log-processing.md),
[transport](otlp-logs.md), [mapping](otlp-logs-json.md),
[host](jobs-logs-export.md) and [proof](otlp-logs-testing.md).

---

## 36. Predeclared D1 Batches and Persistent Worker Tasks

The portable database package now has a separate BatchDatabase capability using
its existing SQL statements/results. A complete statement plan executes atomically;
no JavaScript callback transaction is inferred. The optional Workers /d1 provider
borrows a native database/session, validates/copies complete inputs, rejects manual
transaction controls and bounds accepted work until the real binding settles.
Close drains the handle without deleting platform data. Result decoding follows
native commit; unsafe numbers and oversized output can reject after a write.

The separate batch migration entrypoint snapshots/checksums manifests, validates
an exact history prefix and commits one guarded complete suffix. Concurrent stale
plans cannot both apply an upgrade. Application startup verifies history/columns
read-only; a trusted deployment worker owns schema changes. The local host privately
invokes and removes that worker before reporting readiness, retaining storage and
explicit per-worker compatibility settings through reload.

The task repository uses conditional revision SQL and unique mutation identities
to commit each task change and activity entry together. Decimal-string keyset
cursors with CAST text preserve positions beyond JavaScript's safe integer range.
Actual local D1 proves rollback, schema races, one-winner cross-worker edits,
activity failure atomicity and retained state across a workerd process restart.
Existing callback-based queue/auth/idempotency/outbox stores remain separate;
managed cloud deployment/replication need their own proof. See
[capability](batch-database.md), [schema](batch-migrations.md),
[provider](workers-d1.md), [deployment](d1-deployment.md), [tasks](d1-tasks.md),
[activity](d1-task-activity.md), [pages](d1-pagination.md) and [proof](d1-testing.md).

---

## 37. Predeclared Request Replay and Positive Commit Recovery

The optional idempotency /batch-sqlite entrypoint accepts a complete business
SQL plan and known strict JSON response. All inputs are snapshotted before hashing.
One native batch removes this key's expired generation, inserts its complete
response record and executes business SQL. Unique ownership rejects duplicate
plans before business statements; native rollback restores old generations and
business state together on failure.

After an error, one read checks committed evidence. Matching eligible input
replays JSON; changed input conflicts. Its own generation claim can establish
success after acknowledgement loss or post-commit decoding failure. Unavailable
evidence leaves a storage error; no business batch is automatically retried.
Retention uses captured admission time; callback services retain their completion
clock policy. Explicit bounded cleanup deletes only expired request records.

TaskDatabase, TaskRequests and Tasks connect through DI. Optional HTTP keys preserve
the original 201/body/Location after live edits/deletion. The manifest appends its
ledger without changing task/activity SQL. Actual workerd proves legacy upgrade,
cross-worker ownership, client socket loss and retained process restart. Numeric
keyset queries qualify integer ORDER BY while projecting text cursors, preserving
9/10 and int64 order. See [API](batch-idempotency.md),
[records](batch-idempotency-storage.md), [HTTP](d1-idempotency-http.md),
[upgrade](d1-idempotency-upgrades.md) and [proof](d1-idempotency-testing.md).

---

## 38. Persistent Application Templates and Owned Development

The generator now selects an application profile alongside runtime. api remains
the four-runtime default; d1-tasks requires Workers. The CLI build copies actual
D1 source and supporting scripts/guides into its distribution. A versioned asset
descriptor records dependency sets and hashes; generation checks required files,
paths, UTF-8 and byte bounds before staging. Only the selected framework dependency
closure enters the generated project.

Installed packed binaries create the same editable independent D1 application.
Relative overrides/browser builds survive relocation. The watcher serializes native
host replacement on successful builds, retains the old host on compilation errors
and awaits owned shutdown. Retained schema/data/replay use the existing private
deployment protocol. Startup configuration/schema failure closes development.

The installed app ships its own actual D1/restart test and individual guides.
Native verification covers packed creation, fresh/frozen install, real HTTP/replay,
watcher failure/recovery and retained restart through installed CLI scripts. See
[profile](d1-starter.md), [assets](d1-starter-snapshot.md),
[development](d1-starter-development.md) and [proof](d1-starter-testing.md).

---

## 39. Native SQLite Application Profiles and Shared Asset Validation

sqlite-tasks adds the existing Node application to the fixed template catalog.
Named profile wrappers share descriptor/file/hash validation while retaining their
own runtime, required source, scripts and build approvals. D1 descriptor version 1
and its output stay compatible. The builder copies actual application source and
tests, excluding the separate Redis host, plus a checked adaptation of the native
persistence gate. Generation selects the correct framework closure and relative
overrides before atomically publishing independent editable files.

The installed Node profile uses project-relative environment/data paths from source
or compiled hosts. Startup owns SQLite schema then cache/events; shutdown drains
HTTP and observers before releasing the file database. Tasks persist across hosts;
activity/cache remain explicit process-local observations with TTL for external
writes. Source watch retains the database without acquiring cloud resources.

Packed installed binaries and automatic/frozen installation prove actual native
HTTP, concurrent writers, restart, environment precedence, cache/event scope,
schema denial and SQLite integrity. D1 and the default four-runtime starters retain
their separate native regressions. See [profile](sqlite-starter.md),
[assets](application-template-assets.md), [lifetime](sqlite-starter-lifecycle.md)
and [proof](sqlite-starter-testing.md).

---

## 40. Native Bun SQLite and Asynchronous Callback Ownership

The optional Bun /sqlite entrypoint implements the existing Database contract with
native bun:sqlite. The HTTP entrypoint stays independent. Inputs are snapshotted,
int64 values remain exact and native statements are finalized deterministically.
The former D1 statement scanner is a shared pure database entrypoint, preserving
trigger bodies while rejecting silently ignored statement suffixes.

Native SQLite calls are synchronous; an in-process canonical-file FIFO owns the
whole asynchronous transaction lifetime. BEGIN IMMEDIATE surrounds the callback,
managed participant drain and commit. Same-file reentrancy rejects instead of
blocking its own event loop. Native automatic rollback fences the delegate before
later SQL can escape into autocommit. Close rejects new admission and drains the
handle's accepted work before native release. Post-materialization result failures
remain potentially post-commit outside an explicit transaction.

The Bun task host imports the existing task app/service/repository, wiring native
storage, migrations, DI and lifecycle to Bun.serve. Native tests run unchanged SQL
queue, scheduler and callback replay protocols. Separate processes prove busy-lock
failure without query replay, pre/post-commit SIGKILL behavior, actual HTTP writers
and retained restart. Node/D1 application profiles keep their own regression gates.
See [provider](bun-sqlite.md), [ownership](bun-sqlite-transactions.md),
[boundary](sqlite-statement-boundary.md), [tasks](bun-sqlite-tasks.md)
and [proof](bun-sqlite-testing.md).

---

## 41. Runtime-Selected SQLite Projects and Owned Bun Development

SQLite task generation now supports Node or Bun through the same public template.
The trusted profile can select a fixed internal asset directory while preserving
its metadata identity and descriptor version. The existing Node and D1 variants
keep their source requirements and scripts. The Bun variant snapshots actual
shared application source, real Bun storage/host wiring and native application
tests with checked runner/listener/type adaptations. Package selection excludes
Node/Workers adapters; relative overrides retain independent editable output.

The generated supervisor runs in Node/esbuild, resolves pinned local Bun and owns
one serial host replacement chain. Failed compilation retains the old host;
successful builds await native shutdown before replacement. Unexpected host exit
or configuration/schema failure stops development. CLI signal forwarding joins
watcher/host cleanup. Data paths stay project-relative, while Bun owns native
environment-file behavior from the project launch directory.

The native project gate is shared with the existing Node variant and retains Node
as its default. Installed packed binaries prove automatic/frozen installation,
actual native source tests, compiled builds, persistence/integrity, concurrent HTTP,
retained restart and failed-compile recovery. Schema drift rejects readiness and
restored source reopens retained state. See [profile](bun-sqlite-starter.md),
[development](bun-sqlite-starter-development.md), [proof](bun-sqlite-starter-testing.md)
and [shared assets](application-template-assets.md).

---

## 42. Bounded Task Reads and Whole-Collection SQL Counts

The existing Node/Bun task application now separates list(query) → TaskPage from
counts() → TaskCounts inside its application store contract. The HTTP list validates
canonical limits/cursors and literal completion filters, rejects duplicate/unknown
parameters and returns tasks with nextCursor. The repository snapshots typed input,
binds predicates and fetches limit + 1 numeric-ID rows. Response pages are bounded
independently of collection size; exact int64 IDs survive JSON as decimal strings.

Summary loaders use one count/sum statement with safe count decoding. Existing
memory/Redis cache envelopes, shared loads, invalidation fences and provider/source
failure boundaries remain unchanged. Pages stay uncached, and summary counts cover
the full collection independently of page filters. Native result limits therefore
do not turn a large task collection into an oversized list or incorrect page total.

Schema history retains the original task table checksum and appends a completed/id
index. Startup upgrades legacy state without rewriting records; old source rejects
the newer manifest prefix. The source and adapted Bun tests prove retained upgrade,
digit-boundary order, wide cursors and deleted cursor rows. The shipped native gate
uses 1029 tasks to verify real HTTP traversal, filters, aggregate totals and live
insertion/deletion. Node/Bun generated projects and cache/event integrations keep
their own native regressions. See [pages](sqlite-task-pages.md),
[counts](sqlite-task-counts.md) and [read proof](sqlite-task-read-upgrades.md).

---

## 43. Optional Rust Computation Behind a Portable Service Contract

The reserved native workspace now contains a locked, independently built Rust
report service. It owns authenticated loopback HTTP, strict bounded JSON, a
versioned pure computation and handler admission/deadline/signal drain. Ordinary
TypeScript builds and generated application profiles do not compile Rust.

The jobs application composes the existing Web Fetch JSON transport with report
schema/result checks and accepted-call ownership. No process/native binding enters
shared packages. ReportCompute selects local or configured native computation through
DI. The handler awaits the result and rechecks cancellation before its stable-ID
database insert. Queue retries can repeat pure computation after transport failure;
native selection adds no implicit fallback or exactly-once remote effect claim.

Native health participates in readiness. Cleanup joins readiness/workers before
client close, then releases storage. The demo owns random service credentials,
actual native/jobs children and temporary SQLite. Native verification runs the
built client on Node/Bun/Deno/workerd, forces real body/capacity/deadline boundaries,
recovers jobs after service outage/restart and proves native/demo/launcher drain.
See [service](rust-reports.md), [client](native-report-client.md),
[jobs](jobs-native-reports.md), [demo](rust-reports-demo.md) and [proof](rust-reports-testing.md).

---

## 44. Optional Node Process Ownership and Asynchronous Report Resources

The isolated @longhorn/node/process entrypoint owns one trusted direct executable
through explicit argv/environment snapshots, bounded UTF-8 readiness frames and
lifetime output, startup cancellation and actual exit. Graceful close escalates
only after its budget and reports forced termination as failure. It does not put
process APIs in shared core, run a shell, supervise descendants or restart children.

The jobs app now acquires a computation resource asynchronously after its database
and before queue/worker/readiness startup. ReportCompute remains the portable
function dependency. Acquisition failure rolls storage back; cleanup joins accepted
reports before computation/client/process release, then closes storage. Configured
external native clients use the same resource path without requiring startup health.

The owned Rust implementation generates a private credential and minimal loopback
environment, validates the ready protocol/address and requires authenticated health.
It releases partial acquisitions before rejection. A separate persistent Node host
handles parent signals before startup, rolls back failed HTTP binds and exposes
child failure through readiness/queue retry. Retained SQLite supports recovery with
a fresh service on host restart. Direct-child fixtures and actual Rust HTTP/restart
gates prove the boundaries; parent crash/service supervision remains deployment-owned.
See [process](managed-node-process.md), [DI](report-computer-resources.md),
[Rust resource](owned-native-reports.md), [host](native-jobs-host.md) and
[proof](managed-process-testing.md).

---

## 45. Native Deno SQLite Behind the Existing Database Contract

The optional @longhorn/deno/sqlite entrypoint uses Deno's built-in node:sqlite
driver without importing native SQL into shared packages or the HTTP adapter.
The adapter snapshots values, validates exact SQLite slot arity and plans native
named/positional bindings without rewriting SQL or column names. It reads int64
as bigint, normalizes safe integer inputs and preserves direct change metadata.
Native all() propagates step errors; output checks follow materialization and do
not claim a native CPU/memory deadline or a write rollback after decode failure.

Canonical main-file identity shares a FIFO gate across handles. Async callbacks
open BEGIN IMMEDIATE, own managed publication through actual completion and verify
native transaction state before subsequent SQL/commit. A caught OR ROLLBACK error
cannot turn later writes into autocommit. The native open path keeps the caller's
granted spelling while canonical identity handles symlink coordination.

The Deno host composes the same task app/repository, checksummed migrations,
events and summary cache with explicit environment/network/file permissions.
Native verification proves exact binding/value boundaries, permission denial,
same-file drain, existing SQL stores, lock/crash recovery and HTTP persistence.
It traverses 1029 tasks and a maximum int64 ID, then actual Node/Bun peers read
and update the same retained file for Deno to serve after restart. Independent
Deno CLI task generation now uses that runnable host through the profile below.
See [provider](deno-sqlite.md), [bindings](deno-sqlite-bindings.md),
[transactions](deno-sqlite-transactions.md), [tasks](deno-sqlite-tasks.md) and
[proof](deno-sqlite-testing.md).

---

## 46. Independent Deno SQLite Generation and Configured Native Development

The CLI's public SQLite application profile now supports Deno without adding a
public template name or changing descriptor version 1. Fixed Deno assets copy
actual task source and host/storage wiring through checked mappings, retain all
six application test files and include only the chosen framework closure.
Test graphs compile to JavaScript, then native Deno runs node:test cases with
real pinned assertions/mocks. A native Deno.Command persistence owner verifies
actual child status and joins output readers before temporary storage cleanup.

Node project tooling reads environment files/process overrides and validates the
same compiled schema before selecting child grants. Deno receives only six app
keys, selected host/data-directory permissions and its explicit versioned policy.
Unique named permission JSON files preserve literal paths and are removed on
normal/failed startup or owned shutdown. The pinned runtime currently labels
named permissions experimental; compatibility remains an executed profile.

The watcher serially drains old hosts before replacements, keeps service on
compile errors, refreshes configuration per launch and stops on native/schema
failure. Installed packed binaries prove relocation/frozen installs, all native
application/persistence checks, actual outside-path/env/network denial, policy
cleanup, concurrent writers, failed compile recovery and restored schema history.
See [profile](deno-sqlite-starter.md), [mapping](deno-sqlite-starter-snapshot.md),
[permissions](deno-sqlite-starter-permissions.md),
[development](deno-sqlite-starter-development.md) and [proof](deno-sqlite-starter-testing.md).

---

## 47. Native Password Policy and Retained Authentication

The optional shared auth/scrypt entry owns fixed v1 wire parameters, Web Crypto
salt generation, UTF-8 bounds, dummy verification, sanitized failures and FIFO
admission through actual native settlement. Trusted Node/Bun/Deno adapters provide
native async scrypt and equal-length timing-safe comparison. No native import or
JavaScript KDF enters shared packages, and no Worker crypto backend is implied by
the browser policy fixture. Existing Node hashes require no rewrite.

Explicit native hosts compose the same credential/session service, SQLite auth
store, cookie/origin/role guards and application lifecycle. Same-file peers observe
session rotation/revocation and current roles. Each hasher/process owns its own
memory budget; HTTP drain waits for accepted native work before closing SQL.

Private-note GET now returns bounded owner-scoped cursor pages and exact int64
strings. Strict query validation rejects unknown/duplicate keys; SQL binds the
fresh user ID and limit-plus-one. The existing owner index supplies rowid order,
so the original auth/note migrations remain unchanged. Live pagination does not
promise a cross-request snapshot. Actual native vectors, signal drain and mixed
retained HTTP tests cover the integration. See [policy](scrypt-password-policy.md),
[Bun](bun-passwords.md), [Deno](deno-passwords.md), [hosts](native-auth-example.md),
[notes](auth-note-pages.md) and [proof](native-password-testing.md).

---

## 48. Independent Native Auth Generation and Owned Development

The explicit sqlite-auth profile selects Node/Bun/Deno through the existing
generator and trusted descriptor v1. The builder copies actual shared auth source,
selects the native host and retains all seven app cases with checked runner/SQLite
mapping. Only the selected framework dependency closure is installed through local
relative file overrides. Each generated feature has a Markdown connection guide.

One Node launcher validates the actual compiled schema, resolves project-relative
configuration and owns actual native exit. Deno receives literal named data-path
grants, selected environment/network access and policy-file cleanup. Node/Bun stay
native without a claimed permission sandbox. The shared watcher preserves service
on compile errors and serially drains old hosts before configured replacement.

Installed packed projects prove exact editable assets, unchanged frozen locks,
native app/persistence checks, independently rederived hashes, retained account
roles/sessions and more than 1000 owner notes. Configuration and original-schema
denial, restored retained state, owned reloads and actual Deno permission boundaries
are verified independently of the workspace. See [profile](auth-starter.md),
[assets](auth-starter-snapshot.md), [launching](auth-starter-launcher.md),
[development](auth-starter-development.md) and [proof](auth-starter-testing.md).

---

## 49. Password Replacement and Credential-Fenced Session Commits

AuthService explicitly enables mutation through its store's atomic password
capability. Current SQL stores also condition session issuance on the copied hash,
including login-only services. SessionManager keeps generated tokens private until
the trusted conditional commit succeeds. Legacy custom stores retain their basic
contract; direct session/raw SQL writers do not automatically join this protocol.

Native verification and replacement hashing happen before SQL ownership. SQLite
uses its managed write transaction; PostgreSQL's ordinary login path uses a shared
transaction advisory lock and existing table privileges. Replacement takes the
matching exclusive lock before user/session rows, samples the service clock after
ownership and commits hash update, subject-session purge and attempt clearing
together. The PostgreSQL operations history appends two hardened functions and
specific runtime grants without changing prior migrations or granting user UPDATE.

Native auth/generated apps and the PostgreSQL operator API expose strict cookie/
origin-guarded password routes. A 204 clears the cookie and requires a fresh login;
roles, notes and other users survive. Real stale/concurrent work, row/file ownership,
trigger rollback, pre-commit SIGKILL and live KDF shutdown are verified. Upgrade all
old login hosts before enabling mutations. See [policy](password-changes.md),
[issuance](password-session-fencing.md), [SQLite](sqlite-password-changes.md),
[PostgreSQL](postgres-password-changes.md), [HTTP](password-change-http.md) and
[proof](password-change-testing.md).

## 50. Browser Account Settings and Reauthentication Outcomes

The existing command console adds an authenticated Account route using the same
DOM helpers, design tokens and cookie API. Its public shell advertises only the
host's configured password capability; a disabled host renders no mutation form.
The browser validates confirmation and preserved Unicode input, then delegates
all verification and atomic replacement to the established service/SQL capability.

Password reauthentication 401 is distinguished from expiry through a fresh
same-subject session read. Ordinary protected 401 handling stays in force. One
in-flight mutation blocks another password submission and login/logout across
navigation. Success clears private UI and requests sign-in; lost, timed-out or
unexpected responses remain explicitly unconfirmed and are never replayed.
Sensitive controls are cleared on submission/navigation/pagehide, private cached
DOM is removed and a restored page reloads its session.

Native Chromium/PostgreSQL/scrypt proof covers both 401 outcomes, real revocation
and throttling, pending/reentered forms, late results, the actual request deadline,
keyboard and accessible screenshots. The independently packed/restored app also
uses its shipped form. See [account](console-account.md),
[proof](console-account-testing.md), [security](console-security.md) and
[password HTTP](password-change-http.md).

## 51. Authenticated Session Revocation and Browser Controls

AuthService opts into a token-owned session-control store with others/all scopes.
Frozen hash-only input enters one borrowed database transaction. SQLite uses its
managed write gate. PostgreSQL takes the existing subject-exclusive password/login
advisory ownership before row locks, then reuses the restricted transaction-auth
function to revalidate the initiating token. The trusted clock is sampled after
ownership; deletion/counts include only live subject rows. READ COMMITTED is
required for fresh post-admission state. No new schema/function or broader runtime
privilege is introduced. Trusted raw session writers remain responsible for joining
the protocol; later logins and already accepted work are not banned/canceled.

Native/generated auth apps and the opt-in PostgreSQL operator expose strict scoped
cookie APIs. Enabled legacy logout-all joins the same authenticated atomic service.
The browser Account route offers both actions under a shared password/session
mutation gate; unknown outcomes remain unconfirmed and are never replayed.
Native races, expiry after real waits, rollback, four pre-commit process deaths,
mixed-host HTTP, accessible browser captures and restored independent-app buttons
verify the integration. See [service](session-controls.md),
[SQLite](sqlite-session-controls.md), [PostgreSQL](postgres-session-controls.md),
[HTTP](session-controls-http.md), [browser](console-session-controls.md) and
[proof](session-controls-testing.md).

## 52. Saved Command Review and Fresh Submission

The browser detail action opens a UUID-only review route, reusing protected detail
reads. A pure numbers helper checks current policy and refuses malformed saved
JSON without coercion. Source numbers prefill an editable form; only explicit
submission creates a separate command/delivery with a new request key under the
current actor. No new clone endpoint or persisted lineage is introduced. The
original row/receipt remains unchanged, and manual ambiguous retries keep the
review form's key until normalized input changes. Native receipts, scope, malformed
legacy data, source cancellation and independently restored assets verify the flow.
See [reuse](command-rerun.md) and [proof](command-rerun-testing.md).

## 53. Displayed Account Admission Consistency

The per-application account adapter can check the optional X-LongHorn-Viewer header
after real cookie authentication and before private handlers. The console supplies
its displayed public user ID. A mismatch cannot select an owner or role, does not
clear the valid other cookie, and returns static VIEWER_CHANGED/401 guidance.
Omitted claims keep ordinary API semantics. This prevents old tab forms/history
requests from silently switching actors when shared cookies change; request/transaction
authorization and already-admitted-read boundaries still apply. Native tests first
reproduced a switched-account 201, then verify rejection, no command write and
preserved other-account history/session. See [viewer binding](console-viewer-binding.md),
[proof](command-rerun-testing.md) and [security](console-security.md).

## 54. Live Delivery Filtering and Status-Bound History Pages

The existing application history repository adds an optional status predicate to
its fixed-queue metadata join. Owner identity remains cookie-derived and global
scope requires explicit current operator admission. Missing metadata forms the
virtual unavailable filter without implying a queue outcome. Returned rows remain
metadata-only, ordered by decimal int64 insertion position with limit+1 seeking.
Unfiltered pages keep v1 cursors; filtered v2 pages bind the exact selected status
alongside viewer/scope/queue. Query inputs are copied before awaiting SQL.

The complete owner migration profile appends two partial indexes after every
existing operation/password migration. Regular transactional builds block writes
during construction; startup/readiness check valid/ready indexes on the expected
tables with unchanged runtime grants. A native rare-state query over 3,000 rows
uses both indexes without forced planner settings. This bounds neither all query
work nor production latency. Membership remains live across pages.

The console adds native labelled selectors in the current kit, resets pagination
on selection and prevents canceled older-page results/errors from entering a new
filter. Native DDL interruption/concurrent deployment, actual queue transitions,
cursor restart/int64/role checks, minimal grants, browser states/cancellation and
independently restored assets verify the connection. See [API](history-status-filters.md),
[cursor rules](history-filter-cursors.md), [deployment](history-filter-migrations.md),
[browser](console-history-filters.md) and [proof](history-filter-testing.md).

## 55. Page-Owned Delivery and Receipt Following

Command detail can follow its existing protected detail/receipt reads until a real
receipt or terminal metadata arrives. One browser-owned controller waits between
settled cycles, caps checks and wall time, and joins visibility/connectivity with
route lifetime. Pause/expiry/navigation abort the cycle and invalidate its generation;
no new run overlaps an unsettled old promise. The API joins page and cycle signals
and checks cancellation before applying response/auth effects. Mutations, history,
recovery forms and schema remain under their existing contracts.

Data regions update without replacing the route or moving focus. Explicit controls
and a polite status region explain paused, complete, unavailable and uncertain
outcomes. Unit clocks exercise default budgets and cancellation races; native SQL,
broker receipts and Chromium prove real results, focus, error stop, viewer/session
boundaries and shipped application behavior. See [behavior](command-live-updates.md),
[lifetime](command-follow-lifecycle.md), [controls](console-command-follow.md) and
[proof](command-follow-testing.md).

## 56. Bounded History Export with Explicit Continuation

The browser export collector traverses the same authenticated metadata pages as
Commands, independently of rendered rows. It copies scope/state, awaits one page
at a time and serializes only named safe fields into versioned NDJSON. Row/page/
UTF-8/time bounds produce explicit continuation summaries; byte rejection retains
the previous page boundary. Failure/cancellation returns no current file. Every
page keeps cookie/viewer and owner/operator admission; no server endpoint, schema,
grant or package dependency is added.

The route owns cancellation and temporary Blob URLs, and binds final download to
its version/hash/subject. Controls preserve focus and require explicit continuation;
no data/cursor enters browser storage or URLs. Live-page semantics remain unchanged,
so files do not claim snapshot consistency. Source cases and real PostgreSQL/download
proof cover limits, 10001-row scale, exact retained continuation, admission changes,
accessible captures and shipped restore. See [feature](history-export.md),
[format](history-export-format.md), [lifetime](history-export-lifecycle.md),
[controls](console-history-export.md) and [proof](history-export-testing.md).

## 57. Canonical History Views and Validated Sign-In Return

A pure Web route codec recognizes the existing console pages and a strict scope/
status query only on command lists. The serializer omits defaults and never encodes
actor, cursor or return-target claims. Selector changes push URL fragments and
render immediately; legacy normalization replaces the current entry. Native Back/
Forward and reload reconstruct a fresh first page under current API admission.

A whitelisted internal view target can survive sign-in, registration or reactive
expiry in memory. Explicit logout resets it. Member all-scope requests reach the
existing server gate and remain denied until the user explicitly opens their own
view. Page cleanup, export/follow cancellation, displayed-viewer consistency and
private DOM fencing remain unchanged. Source/native browser proof covers route
claims, live accounts, paging, download selection and restored assets. See [format](history-view-links.md),
[navigation](console-history-navigation.md), [sign-in](history-view-sign-in.md) and
[proof](history-view-link-testing.md).

## 58. Indexed ID Search and Context-Specific Export

History adds a bounded normalized UUID-prefix q predicate on lower(command ID),
parameterized alongside principal-derived ownership and existing status/position
filters. Explicit metadata projection stays unchanged. Search emits strict v3
continuations binding q/state/viewer/scope/queue; unsearched v1/v2 stay compatible.
Query inputs are copied before awaiting SQL. The complete owner profile appends
global and owner/lower-ID pattern indexes with transactional deployment/readiness;
no prior SQL, schema field or runtime grant is rewritten.

The native form submits or clears explicitly. Saved views and validated sign-in
retain q; changed views cancel old paging/export work. Searched NDJSON uses a v2
header to distinguish its narrowed selection, while ordinary files remain v1.
Native DDL death/concurrency, actual queue states, role isolation, int64 restart,
metadata-only privileges, measured plans and restored assets verify the connection.
See [API](history-id-search.md), [cursor](history-search-cursors.md),
[migration](history-search-migrations.md), [console](console-history-search.md),
[files](history-search-export.md) and [proof](history-search-testing.md).

## 59. Operator Audit Export through Shared Bounded Collection

Audit export traverses the existing protected fixed-queue API, globally or for a
selected delivery. Its domain wrapper validates and copies only the recorded
actor/reason/request/outcome/result fields, including missing results and audit
retained after delivery pruning. Audit NDJSON v1 is separate from command v1/v2.
No endpoint, schema, grant or framework package is added.

An app-local pure Web collector now owns both exports' sequential pagination,
row/page/UTF-8/deadline bounds, duplicate/cursor guards and whole-page continuation.
Domain wrappers keep their projections/headers/errors. A shared page-owned control
fences downloads by route/subject, releases Blob URLs, preserves focus and discards
failed/canceled attempts. Each API page independently checks current admission;
live traversal does not become a snapshot. Native API recovery, actual downloads,
34 new accessible captures, existing command continuation tests and restored
standalone assets verify the connection. See [engine](bounded-page-export.md),
[feature](recovery-audit-export.md), [format](recovery-audit-export-format.md),
[controls](console-audit-export.md) and [proof](recovery-audit-export-testing.md).

## 60. Selected Computed Receipts with Serial Protected Enrichment

Receipt export composes current history pages with existing protected per-command
receipt reads. A shared closed metadata projector preserves ordinary history file
fields, while receipt v1 adds bounded real computed results or an explicit protected
not-found observation. Owner/operator/status/search selection is copied, and direct
command files require exactly the selected fresh command. Delivery state never
substitutes for an actual receipt read.

The app-local collector now awaits serial asynchronous line enrichment after page
metadata/ID/cursor validation, with cancellation/deadline checks around each call.
Receipt files use smaller 1000-command/ten-page bounds and the existing byte/time
policy. Whole enriched pages share one accepted continuation boundary. Every nested
request independently checks current admission; failed attempts yield no file.
Native export-choice generations fence old work, and composed page disposal stops
both detail follow and export. No server endpoint, schema, grant or framework module
is added. Actual broker results, 1002 HTTP writes, retained receipts, 46 captures,
existing export regressions and restored archive files verify the connection. See
[feature](receipt-export.md), [format](receipt-export-format.md), [lifetime](receipt-export-lifecycle.md),
[controls](console-receipt-export.md), [projection](command-metadata-projection.md)
and [proof](receipt-export-testing.md).

## 61. Account-Owned Named Views with Transactional Quota and Revisions

Saved history preferences are an application module over existing PostgreSQL,
account middleware, DI and Idempotency. Pure shared values normalize names and
scope/status/search. Owner-leading keys and every SQL predicate isolate personal
records, including from operators. Current history admission still controls an
opened all-scope selection; storing it does not preserve a role.

Creates take a per-account transaction advisory lock after authentication, then
count/insert below twenty under fresh READ COMMITTED statements. Authentication's
shared ownership alone permits concurrent creates, so it cannot enforce the quota.
Updates/deletes use revision predicates and named-record results commit atomically
with request replies. The complete profile appends 005_history_views, with new
runtime CRUD limited to that table and explicit readiness/regrant requirements.

The native disclosure panel reopens canonical URLs, keeps stable request keys for
uncertain retries, exposes conflict refresh and fences late callbacks. Private
form text clears on page disposal alongside export work. Optional preference-read
failure leaves command history available. Actual native quota/revision races,
DDL/write SIGKILL, waiting-session revocation, 54 new accessible captures and a
restored standalone preference verify the connection. See [feature](saved-history-views.md),
[values](saved-view-values.md), [HTTP](saved-view-http.md), [ownership](saved-view-concurrency.md),
[schema](saved-view-migrations.md), [UI](console-saved-views.md) and [proof](saved-view-testing.md).


## 62. Lifecycle-Owned Expired Request Cleanup

An optional pure Web subpath schedules existing Idempotency.prune calls without
changing stores, clocks, SQL or retention. One admitted batch settles before its
interval begins; full batches and errors never spin or overlap. Shutdown wakes
idle waits and drains real SQL plus async error observation before pool release.
A private aggregate snapshot records local runs/removals/errors without request data.

The PostgreSQL operator host opts in through typed default-off configuration and
an existing DI request provider. Enabled startup/readiness verifies existing ledger
SELECT/DELETE authority; no schema, migration, grant or endpoint is added. Cleanup
applies table-wide to expired replies, while live replays and business records keep
their lifetimes. Multiple hosts have independent budgets.

Actual Node/Bun/Deno SQLite and restricted PostgreSQL prove deletion/replay/expiry,
permission recovery, active replacement ownership and blocked SQL drain. A finite
workerd invocation proves the portable loop contract, without a persistent timer
claim. The independent restored archive exercises its shipped opt-in configuration.
See [worker](idempotency-cleanup.md), [lifetime](idempotency-cleanup-lifecycle.md),
[retention](request-cleanup-retention.md), [host](request-cleanup-host.md) and
[proof](request-cleanup-testing.md).


## 63. One Command Application Template across CLI and Archive

The command-app profile makes the complete Node/PostgreSQL workflow available to
both CLI creation entrypoints. Its checked descriptor copies the working app,
console, receiver, tests, migrations and guides, selecting the local framework
closure and separate receiver dependencies. Shared reader bounds and atomic
staging apply before publication. Incompatible runtimes fail before output.

Archive creation now delegates to this same generator instead of maintaining a
second source recipe; packaging still adds a resolved lock, hash and checksum.
CLI generation resolves only when installation is requested. Explicit setup remains
responsible for database owner/runtime roles and retained receiver configuration.

The unchanged fixed start script selects a direct Node resource owner with one
forwarded shutdown request. Custom scripts/hooks keep pnpm behavior. Installed
relocated CLI packages prove both entrypoints, damaged/missing asset rejection,
failed install retention, exact source and frozen relocation. Their real app then
runs the complete PostgreSQL/workerd/browser/backup/restore workflow through the
installed CLI, including custom exit codes and POSIX terminal-group interruption.
See [profile](command-project.md), [snapshot](command-project-snapshot.md),
[lifetime](command-project-lifecycle.md) and [proof](command-project-testing.md).


## 64. Source Generations with Serial Native Replacement

The generated command app now has a Node source owner over existing esbuild
settings. Recursive source watches and app-profile polling feed one debounced
revision sequence. Server/browser builds settle in memory together; failed or
superseded work cannot publish. A usable generation drains its current native
child before writing and rechecks admission before starting the replacement.
CLI forwarding targets the unchanged dev owner once, preserving custom scripts.

A separate receiver role watches only receiver source and owns Miniflare/workerd
through its existing host. Both roles keep retained stores and independent output
paths. Shutdown closes watches, settles builds and awaits real child exit. Forced
stop is a failure; configuration/child failures stop the loop instead of silently
serving stale config. One-off builds and arbitrary competing writers remain explicit.

Installed native proof edits actual app/browser/recursive modules and receiver
source, preserves paired output across compile failure, holds SQL-backed HTTP
through reload, consumes the latest edits after drain and retains replay/session/
computed receipts. Private profile recovery, POSIX group interrupts and a real
noncooperative child's forced-stop failure verify the ownership boundary. See
[app loop](command-source-development.md), [builds](command-development-builds.md),
[lifetime](command-development-lifecycle.md), [receiver](receiver-source-development.md)
and [proof](command-development-testing.md).


## 65. Read-Only Runtime Diagnosis through Existing Contracts

An app-local preflight coordinator shares the native operator environment loader,
console asset reads, PostgreSQL schema/role checks and protected transport health.
Startup, /readyz and diagnosis now use one runtime-visible schema helper instead
of duplicate SQL. No migration, grant, provider or business contract is changed.

The check executable emits fixed versioned status/hint data and safe capability
booleans. Failed prerequisites skip dependent checks while independent probes can
still report. The invocation owns its database factory and closes that pool on
all acquired paths. Interruption stops later admission and awaits actual in-flight
SQL/HTTP plus close; it does not fake provider cancellation. The unchanged check
script has a direct CLI owner; custom scripts/hooks retain pnpm semantics.

Real archive and installed CLI probes verify config/assets/connection/role/schema/
grant/cleanup/receiver failures and recovery. A native lock proves interrupted SQL
must settle before report/exit. Seeded pending delivery and expired replay plus
business counts prove no listener, dispatcher or cleanup work starts. The full
workflow rechecks after restore and retains its source-development proof. See
[feature](operator-preflight.md), [format](operator-preflight-report.md),
[readiness](postgres-application-readiness.md), [lifetime](operator-preflight-lifecycle.md)
and [native proof](operator-preflight-testing.md).


## 66. Explicit Request Budgets over Owned Store Reservations

The independent @longhorn/ratelimit package exposes fixed per-subject windows,
scoped SHA-256 keys and copied policy bounds. Memory keeps a bounded indexed
expiry heap and never evicts a live limit. Managed SQLite/PostgreSQL stores acquire
native write ownership before sampling time, reject active policy conflicts and
publish only committed counters. Explicit bounded expiry pruning remains separate
from request admission and from runtime authority.

Hono resolves a caller-selected trusted identity and returns 429 with Retry-After
or a private 503. Downstream and identity errors keep normal Hono handling. Accepted
hash/store work registers before callbacks, so close drains actual work while the
host retains its borrowed database. No timer, provider acquisition or migration
starts implicitly.

The opt-in command budget keys the authenticated account after global body/origin/
auth guards and before command validation/replay. All sessions/hosts share attempts;
denials create no business/outbox/replay effect. An appended package schema and
minimal runtime grants connect readiness, preflight and retained backup state.
Native proof covers all four runtimes, real SQL contention/commit death, killed and
competing owner upgrades, two HTTP hosts and independently restored artifacts.
See [contract](request-limits.md), [providers](rate-limit-sql.md),
[application](command-request-limits.md) and [proof](rate-limit-testing.md).


## 67. Server-Clock Reservations over a Borrowed Redis Port

An explicit server-timed store contract joins the existing RateLimiter without
changing application-clock SQL/memory providers. Server stores receive no host
time and return their sampled observedAt; the coordinator validates it and derives
the existing public retry decision. An explicit now override is rejected for that
mode. Admission/drain still owns accepted work before borrowed resource release.

The optional Redis provider imports only Web Standards. It uses a versioned literal
namespace/scope/hash key, validates policy/count/expiry, then performs one final
SET with native absolute TTL inside EVAL. Denials retain expiry and counts saturate;
policy conflicts/corrupt state fail closed. Native TTL replaces table scanning;
prune returns zero. Runtime needs no delete/scan/admin commands. Hosts own Redis
noeviction, persistence, verified transport and clock policy.

The existing Node command adapter supplies actual TCP/TLS and bounded no-retry
deadlines. A separate protected report example maps a bearer capability to a stable
configured subject and computes real validated results. Two hosts share attempts,
including invalid input; token rotation preserves the same budget. Lost replies
can retain a committed attempt, so close awaits actual work and never refunds it.
Native tests prove contention, queued server time, TTL, ACL, killed AOF recovery
and real HTTP shutdown after a withheld committed reply. Other runtimes execute an
explicit fake protocol client rather than claim an unimplemented native transport.
See [provider](redis-rate-limits.md), [time](rate-limit-server-clock.md),
[example](redis-rate-limit-example.md) and [verification](redis-rate-limit-testing.md).


## 68. Database-Time Limits over Native D1 Batch Execution

The optional batch-sqlite limiter store requires an existing SQLite BatchDatabase
and implements the server-time port. One bound UPSERT/RETURNING computes time in
SQLite, atomically resets/increments a complete bucket and publishes its committed
observation. A live policy mismatch makes no update. There is no callback facade,
pre-write JavaScript time, intermediate claim, follow-up policy read or implicit retry.
Explicit native-time deletion removes a bounded indexed expired prefix across scopes.

The D1 task example/starter appends a separate bucket migration after the unchanged
task/activity/request history. Complete manifest verification remains mandatory,
including when the new capability is off. Private deployment precedes serving.
An enabled provider probes columns and registers TaskCreateLimits after database
acquisition; HTTP/limiter work drains before its borrowed handle closes.

The public task demo keys one server-selected application budget, shared across
enabled workers. Body size runs first; validation, key checks and replay/business
SQL follow consumption. Denials produce no effects, while a later business error
retains its separately committed attempt. Native tests prove rollback, lost replies,
held shutdown, competing upgrades and two-worker admission. The packed relocated
starter also proves separate-host quota retention and original replay after expiry.
See [provider](batch-rate-limits.md), [API](d1-request-limits.md),
[deployment](d1-limit-schema.md) and [native/installed proof](d1-limit-testing.md).


## 69. Existing Managed Limits inside Object Ownership

Durable Object SQL already implements the managed Database transaction contract.
The unchanged SQLite limiter store therefore supplies native input-gate/write
ownership, post-lock application time, committed counters and bounded pruning
without another provider facade. Each Object owns its own budget; scoped hashes
do not coordinate distinct Object databases.

The report app registers an optional limiter after its SQL/clock/queue/scheduler
resources. Both submission POSTs share a fixed server-selected application budget,
after body size and before validation or immutable schedule checks. Default-off
typed settings are validated before owner resources. Reads/cancellation/background
work keep their existing execution path. HTTP and limiter work drain before SQL.

Migration composition appends the unchanged bucket schema after each complete old
profile, including the alarm suffix. Disable/re-enable preserves rows. Quota SQL
still uses the existing all-handle commit hook, while wakeup planning derives only
from real jobs/schedules/leases/failure floors. Quota expiry creates no alarm and
an adequate future wakeup is not slid by denial.

Native proof exercises actual actor aborts before/after commit, held input-gate
clock/shutdown, forty clients, old-profile upgrade rollback and real background
sums. Separate shipped hosts prove retained budgets, unmetered processing while
disabled and private live-policy failure after re-enabling.
See [store](object-request-limits.md), [API](object-report-limits.md),
[deployment](object-limit-deployment.md), [lifetime](object-limit-lifecycle.md) and
[verification](object-limit-testing.md).
