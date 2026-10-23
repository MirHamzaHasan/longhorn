# Deno runtime adapter

Owner: `@longhorn/deno`. Connects [portable Fetch contracts](runtimes.md) to native
`Deno.serve`. It imports no Node server module. Deno development globals are confined
to this adapter's TypeScript project; its published declarations use shared types.

```ts
import { Longhorn } from '@longhorn/core'
import { denoRuntime } from '@longhorn/deno'

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
