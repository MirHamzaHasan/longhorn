# Persistent auth example

Owner: `examples/auth`. Exercises credentials, native password hashing, durable
sessions, cookie/origin boundaries, role guards, owner-scoped notes, DI, and lifecycle.
The separate [tasks example](tasks-example.md) retains its public API and database.

```sh
pnpm dev:auth
pnpm dev:auth:bun
pnpm dev:auth:deno
```

All three select native listeners, SQLite and compatible scrypt through the same
shared application. See [native hosts](native-auth-example.md) for runtime-specific
environment, permissions and shutdown. Default address: `http://127.0.0.1:3001`.
Node settings come from optional `.env` and
`.env.local` files in `examples/auth`, then process environment. Copy `.env.example`
there for local changes. The database defaults to `examples/auth/data/auth.sqlite`.
No seed user or default password is created. Committed accounts, sessions, notes,
and login-attempt counters survive restarts.

The example explicitly selects insecure cookies for its loopback HTTP origin.
For an HTTPS deployment, set `AUTH_COOKIE_SECURE=true` and `AUTH_ORIGIN` to the
exact public HTTPS origin; TLS termination remains host/application-owned. Changing
the public address/port requires matching `AUTH_ORIGIN`. `PORT=0` is useful for
native verification, which supplies the configured Origin explicitly.

```sh
# Use your own passphrase. Username registration does not log in automatically.
curl http://127.0.0.1:3001/auth/register \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'

curl http://127.0.0.1:3001/auth/login -c /tmp/longhorn-cookies.txt \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'

curl http://127.0.0.1:3001/auth/session -b /tmp/longhorn-cookies.txt
curl http://127.0.0.1:3001/notes -b /tmp/longhorn-cookies.txt \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"title":"My private note"}'
curl http://127.0.0.1:3001/notes -b /tmp/longhorn-cookies.txt
curl http://127.0.0.1:3001/auth/logout -X POST -b /tmp/longhorn-cookies.txt \
  -H 'Origin: http://127.0.0.1:3001'
```

The cookie file is a client credential; remove it after local testing. Request logs
exclude bodies and cookies. The server never includes raw session tokens or password
hashes in response JSON.

## Routes and files

| Route | Behavior |
| --- | --- |
| GET `/health` | Public health response |
| POST `/auth/register` | Create a member account; 201 or validation/conflict error |
| POST `/auth/login` | Verify credentials, rotate a supplied cookie, issue a fresh session |
| GET `/auth/session` | Public principal and expiry, or 401 |
| POST `/auth/logout` | Revoke current token and clear cookie; idempotent 204 |
| POST `/auth/logout-all` | Revoke the authenticated user's sessions across devices/processes |
| GET `/admin` | Require current `admin` role; registration cannot grant it |
| GET `/notes` | Owner-scoped cursor page `{ notes, nextCursor }`; default 20, max 100 |
| POST `/notes` | Create a note owned by the authenticated user |
| DELETE `/notes/:id` | Delete only an owned note; other/missing IDs return 404 |

`src/config.ts` owns typed settings. `src/index.ts`, `bun.ts` and `deno.ts` supply native environment,
logger, shared scrypt hasher, SQLite acquisition, listener, and signals. `src/app.ts`
owns migrations/DI registration, the typed Hono auth subrouter, validation, and
owner-scoped queries; `src/notes.ts` owns [bounded list reads](auth-note-pages.md).
Follow `nextCursor` to read the whole collection; this replaces the previous unbounded
list response. The database is acquired on startup and released after drain.
All covered responses use `no-store`; unsafe methods require the configured Origin.
Bodies are limited to 8 KiB before route parsing. Registration rejects client role
fields. Framework/core remains independent of these application routes.

## Feature guides and verification

See [credentials](authentication.md), [passwords](passwords.md), [sessions](sessions.md),
[HTTP cookies](auth-http.md), [authorization](authorization.md), and
[SQLite auth storage](auth-sqlite.md) for APIs, contracts, dependencies, and limits.

`pnpm test:auth` builds first, then verifies native scrypt, HTTP/cookie flags, two-user
ownership, current roles, durable sessions and notes, rotation, expiry, cross-process
logout/all-device revocation, throttling after restart, integrity, clean shutdown,
and omission of secrets from logs. It uses temporary databases only. A separate
browser bundle runs shared auth in actual workerd with explicit test-only providers.
Unit/HTTP tests also exercise the failure cases without paying native hash costs
for every assertion.

`pnpm test:native-auth` adds independent Node/Bun/Deno password vectors, actual
SIGTERM during native registration and a mixed three-host retained database check,
including more than 1000 owner-scoped notes. See [native proof](native-password-testing.md).
