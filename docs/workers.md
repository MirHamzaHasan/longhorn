# Cloudflare Workers Fetch adapter

Owner: `@longhornjs/workers`. Connects a contextual Fetch application to the platform's
`fetch(request, env, ctx)` export. Workers owns sockets and isolate lifetime, so this
adapter exports `createWorker()` rather than implementing a TCP `serve()` method.

```ts
import { Longhorn } from '@longhornjs/core'
import { createWorker } from '@longhornjs/workers'

type Bindings = { GREETING: string }
const app = new Longhorn<Bindings>()
app.http.get('/', (c) => c.json({ message: c.env.GREETING }))

export default createWorker<Bindings>(app)
```

Each call forwards the original Request, bindings, and execution context. It does
not replace environment globals, copy bindings into a shared object, or close the
app after returning a response. Bindings remain per-request; concurrent dispatches
cannot overwrite one another through this adapter. The platform context retains
its original method ownership and identity.

`WorkerExecutionContext` uses the relevant subset of Cloudflare's types:
`waitUntil`, `passThroughOnException`, and `props`. The original runtime object is
still forwarded intact. Host-level rejected Fetch promises propagate to platform
error policy. Errors caught by Hono retain [LongHorn's HTTP behavior](http.md).

## Lifecycle and background work

`app.fetch()` starts the shared application once and tracks handler completion.
Do not close a module-scoped app at the end of every request. Workers does not offer
a general guaranteed isolate-eviction callback for application cleanup; use platform
bindings and appropriate request/background lifetimes rather than Node process hooks.

Inside a handler, `c.executionCtx.waitUntil(promise)` delegates to the real platform
context and can extend work past the response. LongHorn does not replace that
ownership mechanism. See [Cloudflare's context API](https://developers.cloudflare.com/workers/runtime-apis/context/).
Node environment readers and the native SQLite adapter are not part of a Worker
bundle; choose storage through Worker bindings or a suitable provider.

## Example and verification

`pnpm dev:workers` builds a browser-targeted Worker module and starts local workerd
through Miniflare. The [portable example](portable-example.md) receives a `GREETING`
binding and an `AUDIT` KV namespace. `/background` schedules a delayed KV write through
`waitUntil`; `/audit` reads its last request ID. Local KV data is temporary.

`pnpm test:runtimes` runs this module in actual local workerd, exercises HTTP/DI/
validation/request IDs, checks the greeting binding, and confirms background KV work
finishes after the response. [Unit tests](../runtimes/workers/src/workers.test.ts)
also verify identity forwarding, concurrent binding isolation, one shared startup,
and platform-level error propagation.

Local tooling pins Miniflare 3.20250718.3 and workerd 1.20250718.0 with compatibility
date `2025-07-18` to retain the repository's Node 20.19+ development baseline.
This verifies that declared local runtime, not a deployed Cloudflare account or every
current platform API. Deployment configuration and production bindings remain
application-owned. No account connection or deployment is performed.

## Scheduled events

`@longhornjs/workers/scheduled` adds `createScheduledWorker(app, options)` with both
Fetch and scheduled exports. It preserves each event's controller/bindings/context,
shares startup, bounds scheduled admission, and registers the managed callback's
completion with platform waitUntil. Its cooperative budget keeps resources/slots
until actual work settles. Retry suppression is an explicit application decision.
See [adapter](workers-scheduled.md), [invocation ownership](scheduled-invocations.md),
[telemetry](scheduled-telemetry.md), and [native proofs](workers-scheduled-testing.md).

`pnpm dev:scheduled-worker` runs the separate KV audit example at port 3005.
Its scheduler/queue state is invocation-local; replay overwrites a stable KV key.
The pinned local host exposes an internal manual trigger; production Cron Triggers
and bindings need separate application configuration. See [the example](workers-scheduled-example.md).

The standalone local host replaces the synchronous signal handlers installed by
this pinned Miniflare version with its own awaited `dispose()` handler. It retains
Miniflare's process-exit fallback and any pre-existing signal listeners. The runtime
verification also launches this host and checks its shutdown log and clean exit.

## Durable Object SQL

`@longhornjs/workers/durable-sqlite` borrows a SQLite-backed Object's storage through
the existing Database interface. Native transactions and input gates protect
callback work; SQL values use the platform's safe-number boundary. Existing SQLite
queue/scheduler stores run above it without importing Node. See
[provider](workers-durable-sqlite.md), [ownership](durable-sqlite-transactions.md),
[migrations](durable-sqlite-migrations.md), [queues](workers-durable-queues.md),
[dispatch](workers-durable-scheduler.md) and [native tests](workers-durable-testing.md).

`pnpm dev:durable-worker` runs the report example at port 3006 with persistent local
Object SQL. Queue/definition/result rows survive restart; a platform event performs
a bounded dispatch/process batch. See [the example](workers-durable-example.md)
for commands and the distinction between platform wakeups and durable SQL state.

## Queue events

`@longhornjs/workers/queue` adds createQueueWorker with Fetch and queue exports.
It forwards platform objects, bounds batch/message work, registers the managed
completion with waitUntil and requires explicit ack/retry decisions. It drains
actual callbacks and afterBatch telemetry even when a cooperative budget expires.
See [events](workers-queue-events.md), [decisions](queue-message-decisions.md),
[batch ownership](queue-batch-lifecycle.md) and [telemetry](queue-consumer-telemetry.md).

`pnpm dev:queue-worker` starts the producer/consumer receipt app at port 3007.
`pnpm test:worker-queues` checks actual native event flags, broker retry/dead-letter,
Object SQL effects and shutdown. The pinned local broker's handling of partial
failure redelivery is explicitly documented in [native proofs](workers-queue-testing.md).
Cloud queue provisioning and deployment remain application-owned.

## Object alarm timing

`@longhornjs/workers/sqlite-alarms` projects the earliest schedule, pending job or
running lease deadline into the Object's native alarm. An optional internal SQL
commit hook makes queue/cursor/failure-floor changes and alarm rearming atomic.
See [host API](workers-sqlite-alarms.md), [planning](alarm-wakeup-planning.md),
[schema](alarm-migrations.md), [recovery](alarm-recovery.md) and
[telemetry](alarm-telemetry.md).

`pnpm dev:alarm-worker` runs automatic reports at port 3008 alongside the retained
manual cron example. Its launcher performs one known-Object startup activation
for the pinned local runtime; native alarms then own processing. Native QA covers
Object interruption, persisted state, automatic lease/backlog recovery and cold
local-host bootstrap. See [example](alarm-report-example.md) and
[proofs](workers-alarm-testing.md). No cloud deployment is performed.
