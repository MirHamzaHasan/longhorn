# Bun runtime adapter

Owner: `@longhorn/bun`. Connects [portable Fetch contracts](runtimes.md) to native
`Bun.serve`. It imports no Node server module and does not route traffic through the
Node adapter. Its public declarations use shared runtime types, not Bun-specific
types. Bun's development types are confined to the adapter's TypeScript project.

```ts
import { Longhorn } from '@longhorn/core'
import { bunRuntime } from '@longhorn/bun'

const app = new Longhorn()
app.http.get('/health', (c) => c.json({ status: 'ok' }))
const server = await app.listen(bunRuntime, { hostname: '127.0.0.1', port: 3000 })
// Later, from host code:
await app.close()
```

`serve(application, options)` is also exported for request-only Fetch applications.
Calling it outside Bun rejects with an explicit host error. Defaults are
`127.0.0.1:3000`, shared with the Node and Deno adapters. Ports must be integers from
0 through 65535, with 0 requesting an available port. Empty hostnames are rejected.

Startup reports the actual TCP port and URL. Port reuse is disabled, and a busy
port rejects. Development error pages are disabled; an uncaught handler rejection
outside LongHorn's HTTP handler is logged to the console and returns generic JSON
500. Normal application errors use [core HTTP policy](http.md) and [logging](logging.md).

Listener close memoizes the promise returned by `server.stop()`. Bun stops accepting
connections, closes idle connections, and waits for active responses. Core then
releases [lifecycle resources](lifecycle.md). See [Bun's server API](https://bun.sh/docs/runtime/http/server).
Host signals remain application code. TLS, Unix sockets, WebSocket upgrade options,
and native connection objects are not exposed by this initial portable adapter.

## Example and verification

Run `pnpm dev:bun`, or `PORT=4000 pnpm dev:bun`. This builds and runs the
[portable example](portable-example.md) using the pinned local Bun binary. Its host
reads `Bun.env`, validates [configuration](configuration.md), creates a logger, and
connects signals to `app.close()`.

`pnpm test:runtimes` runs the actual Bun executable, not a mocked API. The
[native fixture](../scripts/fixtures/verify-native-runtime.mjs) verifies invalid
options, an occupied port, actual TCP requests, resource startup, draining, cleanup,
port reuse after close, and generic transport errors. The executable example verifies
DI, JSON validation, request IDs, structured logs, and signal shutdown.
Bun 1.4.4 is pinned for reproducible verification.

## Native persistent storage

The optional [Bun SQLite provider](bun-sqlite.md) uses `bun:sqlite` behind the
existing Database contract. Its [async transaction ownership](bun-sqlite-transactions.md)
keeps native locks through callback/participant completion. SQL itself remains
synchronous and can block Bun's event loop. The HTTP entrypoint does not import it.
Run `pnpm dev:bun-sqlite` for the [persistent task host](bun-sqlite-tasks.md), and
`pnpm test:bun-sqlite` for [native storage/process verification](bun-sqlite-testing.md).
