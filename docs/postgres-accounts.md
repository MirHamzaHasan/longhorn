# PostgreSQL account HTTP integration

Owner: examples/postgres/src/accounts.ts, connected by createPostgresApp.
Connects [auth storage](auth-postgres.md), [sessions](postgres-sessions.md),
[throttling](postgres-login-attempts.md), [private notes](postgres-private-notes.md),
[DI](dependency-injection.md), [cookies](auth-http.md), and [native QA](postgres-auth-testing.md).

```sh
pnpm demo:postgres
curl http://127.0.0.1:3003/account/register \
  -H 'Origin: http://127.0.0.1:3003' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'
curl -c /tmp/longhorn-demo.cookies http://127.0.0.1:3003/account/login \
  -H 'Origin: http://127.0.0.1:3003' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'
curl -b /tmp/longhorn-demo.cookies http://127.0.0.1:3003/account/notes
```

The demo owns temporary data; Ctrl+C removes its database. For persistent development,
use supplied runtime/owner DATABASE_URL/MIGRATION_DATABASE_URL, run migrate:postgres,
grant [specific resources](postgres-roles.md), then dev:postgres. One complete
postgresExampleMigrations export in migrations.ts preserves the previous task/job
history and appends auth/private-note resources. Runtime never runs DDL.

| Route under /account | Behavior |
| --- | --- |
| POST /register | Validated username/password, member-only role, 201; duplicate 409 |
| POST /login | Native password verification, fresh/rotated cookie, public user + expiry |
| GET /session | Public current principal or 401 |
| POST /logout | Revoke current cookie and clear it, 204 |
| POST /logout-all | Require user, revoke their device sessions and clear cookie, 204 |
| GET /admin | Require current admin role, otherwise 401/403 |
| GET/POST /notes, GET/DELETE /notes/:id | Guarded owner-scoped private data |

Every state-changing account request requires the exact configured Origin and rejects
cross-site Sec-Fetch-Site. Cookie middleware is mounted only under /account; public
tasks/report endpoints preserve their existing behavior. Account responses are
no-store and vary on Cookie. Bodies share the app's 8192-byte limit. Strict write
schemas reject client-supplied roles/owners. Passwords/tokens are excluded from public
responses and normal request logs. Wrong/missing credentials share a generic 401;
throttling returns 429 and hashing capacity returns 503.

The executable enables accounts using native scrypt and defaults AUTH_ORIGIN to
http://127.0.0.1:3003, AUTH_COOKIE_SECURE=false and SESSION_TTL_SECONDS=28800
(allowed 1–2592000). This explicitly opts into loopback development cookies. A
different port/browser origin requires matching AUTH_ORIGIN. HTTPS deployments use
AUTH_COOKIE_SECURE=true and an exact HTTPS origin, yielding __Host-id Secure/HttpOnly/
SameSite=Strict/Path=/ cookies; insecure non-loopback origins are rejected.

Programmatic callers opt in with createPostgresApp({openDatabase,accounts:{origin,
secure,sessionTtlMs,passwords}}). Omitting accounts leaves those routes disabled.
DI connects PgDatabase -> PgAuthStore -> PgAccounts and PgPrivateNotes. Startup checks
required tables and resolves account configuration before listening; a failure closes
the acquired pool. HTTP drains before database release. Existing background worker/
timing hosts keep their own lifecycle. SQL readiness checks tables/connectivity,
not future password-provider success or account status.

This module does not make public tasks private, add RLS, supply a sign-up UI, or add
password reset/MFA/OAuth/admin mutation APIs. The same authorization/password/session
contracts used by the SQLite example remain in place above the provider boundary.
