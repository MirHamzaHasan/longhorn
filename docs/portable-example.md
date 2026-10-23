# Portable runtime example

Owner: `examples/portable`. One shared app runs through [Bun](bun.md), [Deno](deno.md),
and [Workers](workers.md). It exercises framework composition without importing the
Node-only SQLite resource from the separate [tasks application](tasks-example.md).

The shared diagnostics module also exposes /livez, /readyz, /metrics and /traces.
Readiness checks initialized app state; it makes no database claim. Request metrics
use fixed labels/templates and spans use a bounded local exporter. Lifecycle closes
readiness before state resources, then final tracing/metrics. See [observability](observability.md),
[health](health-checks.md), [metrics](metrics.md), and [HTTP telemetry](http-telemetry.md).
Runtime gates verify these routes in Bun/Deno and actual browser-bundled workerd.

| Part | Source | Connection |
| --- | --- | --- |
| Shared app | [app.ts](../examples/portable/src/app.ts) | Core, DI state, startup/cleanup, validation, request logs, scoped events, public profile cache |
| Config schema | [config.ts](../examples/portable/src/config.ts) | Shared config loader transforms host-provided records |
| Bun host | [bun.ts](../examples/portable/src/bun.ts) | Bun.env, native listener, signal shutdown |
| Deno host | [deno.ts](../examples/portable/src/deno.ts) | Permissioned Deno.env, native listener, signal cleanup |
| Worker export | [worker.ts](../examples/portable/src/worker.ts) | Per-request bindings, execution context, waitUntil, KV |
| Build | [build.mjs](../examples/portable/build.mjs) | Native host entries plus a bundled browser Worker |

## Run

```sh
pnpm dev:bun
pnpm dev:deno
pnpm dev:workers
```

Run one command at a time on default port 3000, or choose another `PORT`. Bun/Deno
also accept `HOST` and `LOG_LEVEL`; the Deno development launcher grants loopback
network access, so another interface needs a matching Deno permission. The local
Worker host accepts `HOST`, `PORT`, and `GREETING`. All commands build the needed
workspace packages first. Ctrl+C requests host shutdown.
Host signal handlers ignore repeated shutdown requests while cleanup is running.

Bun and Deno binaries are pinned local test dependencies under aliases; pnpm remains
the repository's package manager. No global runtime installation is required for
these commands. The Worker runs locally through pinned Miniflare/workerd, with no
deployment or account credentials.

## Routes

| Route | Behavior |
| --- | --- |
| GET `/health` | Runtime name and startup-ready DI state |
| GET `/` | Runtime name and greeting; Workers receives its greeting via a binding |
| POST `/echo` | Validates/trims JSON `{ "message": "..." }` and returns the runtime/state |
| GET `/events` | Process/isolate echo count and last correlated request ID |
| GET `/cached` | Public runtime/timestamp snapshot cached locally for five seconds |
| POST `/cached/invalidate` | Invalidate that local profile key |
| GET `/failure` | Deliberate example error demonstrating generic JSON 500 and correlated logs |
| GET `/background` | Workers only: queue a delayed KV write with the response request ID |
| GET `/audit` | Workers only: read the last background request ID |

Request IDs and validation/error behavior come from shared framework packages.
Successful `/echo` calls await a typed event; a scoped async observer records its
count and request ID without retaining the message body. Event cleanup runs before
cache and readiness cleanup on native shutdown. Counts are local and reset on restart. See
[events](events.md) and [subscription ownership](event-subscriptions.md).
Startup state is initialized through a lifecycle hook; Bun and Deno release it only
after their listeners drain. Workers shares the app between requests and uses its
platform context for background lifetime.

The Worker build bundles dependencies with `platform: browser`. A Node builtin in
that production import graph fails the build. Public profiles use a typed [cache](cache.md) and [memory adapter](memory-cache.md).
They contain no per-request binding data; the greeting remains an uncached binding
read. Cache cleanup waits for accepted loaders before releasing readiness.

Native host entries keep workspace
package imports so verification also exercises built package exports. Native type
globals use separate Bun/Deno TypeScript configurations.

## Verification

`pnpm test:runtimes` builds and runs [the verification harness](../scripts/verify-runtimes.mjs).
It launches real Bun/Deno executables for transport/lifecycle checks, then runs each
host example and checks config, DI, validation, awaited events, logs, and signals. It also launches
actual local workerd and verifies bindings and waitUntil-backed KV work. No native
API is mocked for these checks.
The local Worker launcher is checked separately for awaited disposal and a clean
exit after a shutdown signal.

The portable example is not a claim that a Node-native storage driver can be loaded
on every runtime. Store implementations remain runtime/provider choices behind the
[database](database.md) and application service contracts.
