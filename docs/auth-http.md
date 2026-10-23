# Cookie authentication for Hono

Owner: `cookieAuth` from `@longhorn/auth/hono`. Connects an application-resolved
[AuthService](authentication.md), browser cookies, origin checks, and
[authorization](authorization.md). The root auth package has no HTTP imports.

```ts
import { Hono } from 'hono'
import type { AuthEnv } from '@longhorn/auth/hono'
import { cookieAuth } from '@longhorn/auth/hono'

const routes = new Hono<AuthEnv>()
const cookies = cookieAuth<AuthEnv>({
  origin: 'https://app.example',
  resolve: () => authService,
})
routes.use('*', cookies.middleware)
routes.get('/me', cookies.requireUser, (c) => c.json(c.get('auth')!))
```

With LongHorn DI, use a typed Hono subrouter combining `LonghornEnv & AuthEnv` and
resolve the service through `c.get('container')`. Mount it with `app.http.route()`.
This preserves native Hono typing without changing core's default context. The
[example](auth-example.md) shows registration/login handlers and lifecycle wiring.

## Cookies and delivery

Default secure mode requires an HTTPS origin. The session cookie is `__Host-id`,
with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and an absolute expiry. There
is no Domain attribute. `setSession(context, issuedSession)` delivers a successful
login's token; responses should return only public user data and expiry, not the
token or its stored hash. `clearSession(context)` uses matching cookie attributes.

Explicit `secure: false` is accepted only with an HTTP origin on `localhost`,
`127.0.0.1`, or `[::1]`. It uses `longhorn_dev` instead of a misleading `__Host-`
name. Remote insecure origins are rejected during construction. The example opts
into this local development mode; production HTTPS can terminate at an application-
owned proxy while the configured public origin remains HTTPS.

The middleware accepts only its one named cookie. Duplicate cookies of that name
fail closed. It does not read bearer headers, URL tokens, or body session IDs.
Unknown, expired, and revoked cookie values produce no principal; stale values are
cleared. Store errors remain server errors. All covered responses use `Cache-Control:
no-store`, with `Vary: Cookie` initially appended.

## Write-origin policy

Register this middleware before every auth/protected handler, including anonymous
registration and login. Every method except GET, HEAD, and OPTIONS requires an exact
`Origin` match to the configured origin. Missing/null origins, sibling origins,
different schemes/ports, and `Sec-Fetch-Site: cross-site` are rejected with 403 before
session lookup or handler execution. The check applies to JSON and form/simple
content types alike. Non-browser API clients must send the configured Origin too.

The origin must be an exact HTTP(S) origin without a path, credentials, query, or
fragment. It is configured explicitly, not inferred from untrusted Host or forwarded
headers. Do not enable permissive credentialed CORS around these endpoints. GET
handlers must remain free of application state changes. The policy uses strict
source-origin validation; it does not issue a synchronizer CSRF token.

See [OWASP origin verification guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin)
and [Hono's cookie helper](https://hono.dev/docs/helpers/cookie). These defenses do
not prevent same-origin script compromise; application XSS prevention remains
necessary.

## Middleware surface and verification

The factory returns `middleware`, `requireUser`, `requireRole`, `authorize`, `token`,
`setSession`, and `clearSession`. It creates no routes automatically. Credential/body
validation and `AuthError` mapping remain application-owned.

Tests verify cookie flags, origin configuration, unsafe content types/methods,
missing origins, duplicate cookies, ignored bearer/query tokens, authorization,
revocation, and cache headers. `pnpm test:auth` checks the real native HTTP path and
a browser bundle running in local workerd. The workerd fixture uses test-only
providers; it does not imply a production Worker password/database adapter.
