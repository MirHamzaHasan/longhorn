# Application starter templates

Owner: `cli/src/templates.ts`, distributed through [project generation](project-generation.md).
Templates preserve the existing architecture: Hono routes stay in the app, services
use application DI, lifecycle owns resources, and host-specific APIs stay in the
entrypoint. No runtime-specific imports enter the shared app.

The default api starter includes src/diagnostics.ts with DI-owned readiness, bounded request
metrics and explicit-context tracing. /livez, /readyz, /metrics and /traces run through
the same host. Separate generated guides describe health, metrics and tracing.
Readiness checks app state until real dependencies are added; traces/metrics are
process/isolate-local with no remote collector. Native close drains telemetry;
Workers platform disposal has no guaranteed final flush. Project gates check the
routes after relocation/fresh install, including the browser Worker bundle.
The Workers entrypoint also exports a bounded scheduled handler with awaited
consumer tracing. `/scheduled` shows isolate-local runs and exact event metadata;
the generated `docs/worker-scheduled.md` explains the local trigger and limits.

## Included behavior

This section describes the default api profile. Persistent [D1](d1-starter.md)
and [Node](sqlite-starter.md)/[Bun SQLite](bun-sqlite-starter.md) profiles supply their task application
sources and separate route/lifetime policies. Their asset validation shares the
[trusted template reader](application-template-assets.md), not application behavior.

Each api starter includes `src/app.ts`, a host entrypoint, a meaningful Fetch test,
build/typecheck/test/dev/start scripts, structured logs, typed events, typed caching, and separate Markdown guides
for its implemented features. `/health` reads lifecycle-ready state from DI. `/`
returns a greeting, using a binding when supplied. `POST /echo` uses Standard Schema
validation through Zod and trims messages to 1–200 characters. Successful echoes
await a typed event; `/events` reports an async observer's local count and last request
ID. The message is not retained by that observer. Event scope cleanup drains before
cache/readiness cleanup. See [events](events.md). A public `/cached` runtime profile uses a five-second memory cache, with explicit
`POST /cached/invalidate`. Its timestamp makes reuse visible without caching request
bindings or user input. HTTP no-store separates application caching from browser
caching. See [cache](cache.md) and [memory storage](memory-cache.md).

Core provides JSON
404/500 behavior, request IDs, and correlated request/error logs.

Native hosts validate HOST, PORT, GREETING, and LOG_LEVEL with `@longhorn/config`.
They use loopback port 3000 by default; PORT=0 selects an available port. The host
prints the actual URL. Invalid configuration fails before listening. Signal handlers
await `app.close()` and ignore repeated shutdown requests during cleanup.

| Runtime | Host | Development behavior | Environment and lifetime |
| --- | --- | --- | --- |
| Node | `@longhorn/node` | tsx watches source | Optional .env/.env.local, process values win; host owns signals |
| Bun | `@longhorn/bun` | Bun native watch | Bun.env and Bun's environment-file behavior; native listener drain |
| Deno | `@longhorn/deno` | Deno native watch | Explicit loopback and named environment permissions; native shutdown |
| Workers | `@longhorn/workers` | esbuild watches and reloads successful builds | Per-request GREETING binding, platform execution context, local workerd host |

All starters use pnpm 12.6.0 and Node 20.19+ development tooling. Bun 1.4.4 and Deno
2.9.6 are local aliased dev dependencies, preserving pnpm as package manager. Deno
commands grant only loopback network access and the named settings; changing HOST
requires adjusting the matching network permission. Deno does not load .env files
in this host.

The Workers build bundles with `platform: browser`, which rejects Node builtin
imports in that graph. The development host uses pinned Miniflare 3.20250718.3 and
workerd compatibility date 2025-07-18 to retain Node 20.19+ tooling. It replaces that
SDK's synchronous signal exit with awaited disposal. The local host and watcher are
development resources; the module-scoped app is shared between requests. Do not
close it per request. Production bindings and deployment configuration remain
application-owned. See [Workers](workers.md).

## File connections

```text
src/index.ts -> selected adapter + logger + native config
            -> createApp() -> core -> HTTP + DI + lifecycle + request logging
src/app.ts -> State provider + startup cleanup -> /health
           -> validation/hono + Zod -> /echo
src/app.ts -> event bus + scoped async observer -> /events
src/app.test.ts -> shared Fetch path -> startup, state, bindings, validation, events, errors
build.config.mjs -> native external packages OR browser Worker bundle
```

The generated `docs/features.md` links individual guides for HTTP, DI, lifecycle,
logging, validation, events, caching, runtime, native configuration and managed
application work. Worker scheduled events also have their own generated guide.
`.longhorn/README.md` explains
framework snapshot ownership. These are application guides, independent of this
repository's feature index.

## Verification and boundaries

`pnpm test:projects` verifies generated applications through actual Node, Bun, Deno,
and local workerd, including installation, TypeScript, Fetch tests, production builds,
HTTP requests, source editing/reloading, and process shutdown. Fresh directories and
relocation prevent workspace package links from hiding distribution errors.
The workerd gate dispatches a real local scheduled event and verifies the starter's
exact metadata/counter response and consumer span. This observation resets on
reload/restart and adds no durable queue/schedule state or deployment configuration.

The default api starter is a small runnable application, without persistence or authentication.
The persistent [tasks example](tasks-example.md) remains the integration reference
for adding database contracts, migrations, and lifecycle-owned SQLite on Node.
Choose provider implementations appropriate to the selected runtime. Feature
selection and further templates can build on this generator later. Explicit
`--template d1-tasks --runtime workers` now generates the [persistent D1 profile](d1-starter.md)
with actual task/replay source, private schema phase, local data and an owned
development watcher. It has its own [asset](d1-starter-snapshot.md),
[lifetime](d1-starter-development.md) and [verification](d1-starter-testing.md) guides;
it has a separate route set from the generic greeting/diagnostics profile above.

Snapshots now include the optional `@longhorn/cache/json`, `@longhorn/cache/redis`
and Node-only `@longhorn/node/redis` exports. Starters continue to select memory;
no Redis service/credentials are created by generation. The
[Redis task profile](redis-tasks-example.md) shows explicit provider selection.
The snapshots also retain the optional metric reader and `/otlp-metrics` export.
Generated apps keep their existing local diagnostics; the
[reports metrics profile](jobs-metrics-export.md) demonstrates explicit remote
selection without adding collector credentials or a background reader to starters.
Snapshots retain the optional log processor, sink helpers and `/otlp-logs` export
as well. Default starters keep local logging; [the reports profile](jobs-logs-export.md)
shows explicit remote configuration and final processor ownership.
Snapshots also include optional `@longhorn/database/batch` and
`@longhorn/workers/d1`. Generic starters still add no persistent database or
schema deployment. The [D1 task example](d1-tasks.md) shows that explicit binding,
batch repository and trusted deployment profile.
Snapshots retain optional `@longhorn/idempotency/batch-sqlite` when idempotency is
selected through the graph. Generic starters enable no persistence/request keys;
the [D1 replay profile](d1-idempotency-http.md) supplies explicit DI, deployment
and response retention policy.
