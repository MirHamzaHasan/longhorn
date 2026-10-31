# Deno runtime adapter

Owner: `@longhornjs/deno`. Connects [portable Fetch contracts](runtimes.md) to native
`Deno.serve`. It imports no Node server module. Deno development globals are confined
to this adapter's TypeScript project; its published declarations use shared types.

```ts
import { Longhorn } from '@longhornjs/core'
import { denoRuntime } from '@longhornjs/deno'

const app = new Longhorn()
app.http.get('/health', (c) => c.json({ status: 'ok' }))
const server = await app.listen(denoRuntime, { hostname: '127.0.0.1', port: 3000 })
await app.close()
```

`serve(application, options)` is also exported. Calling it outside Deno rejects with
an explicit host error. Listener options use the same validation/defaults as Node
and Bun: loopback hostname, port 3000, integer ports 0–65535, and no empty hostname.
An explicit zero requests an ephemeral port. The actual `server.addr` supplies the
handle's hostname, port, and IPv6-aware URL. A busy port rejects startup.

The adapter suppresses Deno's default listening message so host logging owns startup
diagnostics. Uncaught handler failures outside LongHorn's HTTP handler are logged
and return generic JSON 500. Normal errors use [HTTP](http.md) and [logging](logging.md).

Close memoizes `server.shutdown()` followed by `server.finished`. Active requests
finish before core releases [resources](lifecycle.md). See
[Deno's HTTP server API](https://docs.deno.com/api/deno/http-server/).
Signal handlers and permission policy remain host code. TLS, Unix sockets, and
native connection information are outside the initial portable contract.

## Example and verification

`pnpm dev:deno` builds and runs the [portable example](portable-example.md) with the
pinned local Deno binary. The example reads only `HOST`, `PORT`, and `LOG_LEVEL`,
validates those records with the shared config package, and removes its signal
listeners during shutdown. The development command grants loopback network access
and those environment keys; adjust Deno's network permission if choosing another
interface. It does not grant unrestricted filesystem or subprocess access.

The launcher uses existing pnpm modules with `--node-modules-dir=manual` and
`--no-lock`, so running the example does not replace dependency installation or add
a Deno lockfile. The [native fixture](../scripts/fixtures/verify-native-runtime.mjs)
uses static imports and needs no runtime read permission for dynamic module loading.

`pnpm test:runtimes` verifies native requests, options, busy ports, draining, cleanup,
rebinding, error responses, and the executable example's configuration, DI,
validation, logs, and signals. Deno 2.9.6 is pinned for verification; the adapter's
type project uses the compatible Deno declaration package.

Optional [Deno SQLite](deno-sqlite.md) now implements the shared Database contract
through a separate native entrypoint, with [binding slots](deno-sqlite-bindings.md),
[async ownership](deno-sqlite-transactions.md), a [persistent task host](deno-sqlite-tasks.md)
and [native verification](deno-sqlite-testing.md). Importing denoRuntime does not
import SQLite. File access stays behind explicit grants in the task host command.

The optional [Deno password adapter](deno-passwords.md) supplies native asynchronous
scrypt with the shared fixed policy. `pnpm dev:auth:deno` composes it with SQLite
and scoped host permissions in the [auth application](native-auth-example.md).
