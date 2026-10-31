# HTTP application

Owners: `@longhornjs/http` and `@longhornjs/core`. Hono provides routing, middleware,
request parsing, response helpers, and router composition. LongHorn composes it with
[DI](dependency-injection.md), [lifecycle](lifecycle.md), and [logging](logging.md).

The optional [service JSON client](service-json-client.md) provides bounded,
explicitly authenticated outbound requests through a separate /client entrypoint.
It imports no Hono and connects HTTP publishing and protected receipt readers.

```ts
import { Longhorn } from '@longhornjs/core'

const app = new Longhorn<{ GREETING: string }>()
app.http.get('/hello/:name', (c) => c.json({
  message: `${c.env.GREETING}, ${c.req.param('name')}`,
  requestId: c.get('requestId'),
}))

const response = await app.fetch(
  new Request('http://localhost/hello/LongHorn'),
  { GREETING: 'Hello' },
)
await app.close()
```

`app.http` is a real Hono app. Mount Hono routers with `route()`, add middleware with
`use()`, and use native handler/context APIs. LongHorn does not duplicate Hono's route
methods. [Validation](validation.md) adds typed schema middleware where needed.

`app.fetch` is a bound portable handler with typed bindings and optional Hono execution
context. It runs startup once before dispatch. Runtime adapters consume the request-only
part of that contract. `app.http.request()` is useful for direct Hono tests and does
not run lifecycle hooks; call `await app.start()` first if those hooks acquire resources.

Core context variables are `container`, `logger`, and `requestId`. The container is
application-scoped; the logger is request-scoped. Every response processed by core
request middleware receives `X-Request-Id`.

## Default errors

`createHttpApp()` from `@longhornjs/http` returns a standalone Hono app with:

- JSON 404: `{ "error": "Not Found" }`.
- Generic JSON 500 for unexpected errors.
- JSON messages for `HTTPException` values without an explicit response.
- Preserved body, headers, and status for explicit `HTTPException` responses.

The standalone factory logs unexpected errors to the console by default. Its optional
`onError(error, context)` observer can report them elsewhere. Core uses this observer
for correlated structured logs. `app.http.onError()` and `notFound()` remain available
for applications replacing the default response policy.

The [runtime adapters](runtimes.md) handle transport. Workers forwards per-request
bindings/context to the same handler. No Node APIs appear in shared HTTP
or core production sources. CORS, body size limits, compression, authentication, and
streaming can use Hono's existing middleware; LongHorn does not enable them implicitly.

Verification: [HTTP defaults](../packages/http/src/http.test.ts),
[Hono/DI composition](../packages/core/src/http.test.ts),
[request logging](../packages/core/src/logging.test.ts), and
[tasks over TCP](../examples/basic/src/app.test.ts).
