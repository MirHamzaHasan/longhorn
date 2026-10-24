# Runtime contracts and adapters

Owners: `@longhorn/runtime`, `@longhorn/core`, and `@longhorn/node`. Shared contracts
connect an [HTTP app](http.md) to a runtime without importing runtime-specific APIs.
Native implementations also include [Bun](bun.md), [Deno](deno.md), and [Workers Fetch](workers.md).
Node also supplies optional native resources through isolated entrypoints:
[SQLite](sqlite.md), [PostgreSQL](postgres.md), [owned processes](managed-node-process.md),
configuration and passwords. Importing
the HTTP adapter/shared core does not import the PostgreSQL driver or open a pool.

## Portable contract

`FetchApplication` exposes `fetch(Request): Response | Promise<Response>`.
`RuntimeAdapter` has a name and `serve(application, options)` returning a
`Promise<ServerHandle>`. Options contain hostname and port. A handle reports the
actual hostname, port, URL, and an idempotent async `close()`.
`resolveServeOptions` validates integer ports 0–65535 and nonempty hostnames, with
consistent loopback/3000 defaults. `ContextualFetchApplication` adds typed bindings
and an execution context for Fetch hosts.

```ts
import { Longhorn } from '@longhorn/core'
import { nodeRuntime } from '@longhorn/node'

const app = new Longhorn()
app.http.get('/health', (c) => c.json({ status: 'ok' }))
const server = await app.listen(nodeRuntime, { hostname: '127.0.0.1', port: 0 })
console.log(server.url)
await app.close()
```

`app.listen` acquires [lifecycle resources](lifecycle.md) before binding. The app owns
the returned listener for shutdown. Several adapters/listeners can share one app in
the same JavaScript process. Core does not create separate runtime processes.

## Registry

`.runtime({ name, adapter })` records descriptive target metadata. Names and adapter
identifiers are trimmed and must be nonempty. Duplicate names are rejected, returned
targets are frozen, and `getRuntime` / `getRuntimes` expose the registered values.
Registration does not import an adapter or start a server. The registry is not a
deployment or cross-process orchestrator.

## Node

`@longhorn/node` uses `@hono/node-server` for Request/Response conversion. `serve()`
also works directly with any `FetchApplication`. Defaults are `127.0.0.1:3000`.
Startup resolves after binding, returns the actual ephemeral port for `port: 0`, and
rejects bind errors. Closing is idempotent; active connections drain before close
resolves. Closing only the returned handle does not release application resources;
use `app.close()` for complete shutdown.

The portable handler does not receive Node incoming/outgoing objects as Hono bindings.
Node environment/file access is a separate `@longhorn/node/config` entrypoint covered
by [configuration](configuration.md). Node.js 20.19.0+ is supported.

## Native and Fetch hosts

| Host | Entrypoint | Ownership |
| --- | --- | --- |
| Node | `app.listen(nodeRuntime)` | Native Node listener through Hono |
| Bun | `app.listen(bunRuntime)` | Native Bun.serve listener |
| Bun SQLite | `@longhorn/bun/sqlite` | Optional native local-file Database and async transaction ownership |
| Deno | `app.listen(denoRuntime)` | Native Deno.serve listener |
| Workers | `export default createWorker(app)` | Platform listener/isolate; per-request env/context |
| Workers scheduled | `export default createScheduledWorker(app, options)` | Fetch plus bounded platform scheduled events and managed completion |

Bun and Deno implement the TCP handle and lifecycle semantics. Workers exposes
contextual Fetch rather than opening a socket. The [portable example](portable-example.md)
exercises shared core, configuration, DI, validation, logging, and platform lifetimes.
The separate [scheduled example](workers-scheduled-example.md) connects platform
events to managed work and KV effects; see [adapter ownership](workers-scheduled.md).

`pnpm test:runtimes` runs real pinned Bun/Deno binaries plus local workerd. Native APIs
are not mocked. Local Workers verification uses the compatibility version documented
in [Workers](workers.md); it does not deploy or assert every live Cloudflare feature.

Verification: [registry tests](../packages/core/src/application.test.ts),
[Node transport tests](../runtimes/node/src/node.test.ts),
[lifecycle races](../packages/core/src/lifecycle.test.ts), and
[active request draining](../examples/basic/src/lifecycle.test.ts).

The Node adapter also exports native [password hashing](passwords.md) through
`@longhorn/node/passwords`, implementing the shared auth contract. The shared auth
root/Hono entrypoints do not import that native adapter.
