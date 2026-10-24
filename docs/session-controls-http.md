# Guarded session control HTTP

Owner: native auth routing in `examples/auth/src/app.ts` and optional PostgreSQL
accounts in `examples/postgres/src/accounts.ts`.

| Host | Route | Enablement |
| --- | --- | --- |
| Native SQLite/auth starters | POST `/auth/sessions/revoke` | Enabled on Node, Bun and Deno auth apps |
| PostgreSQL operator | POST `/account/sessions/revoke` | Explicit `accounts.sessionControls`; operator host/demo enable it |

Send strict JSON `{ "scope": "others" }` or `{ "scope": "all" }`. The existing
exact Origin, cross-site denial, body bounds, HttpOnly/SameSite cookie and no-store
policy apply. Authentication precedes JSON validation. User IDs, roles, token hashes,
unknown scopes and extra fields are rejected. The initiating cookie selects the
account only after fresh transaction-owned reauthentication, not the middleware's
earlier principal snapshot. No bearer/URL tokens or operator-wide subject selection
are added.

Success is 200 with `{ "revokedSessions": number }`, counting live records ended.
`others` keeps the initiating cookie unchanged; `all` clears it. A repeat of others
can return zero; a repeat of all with the old token fails authentication. Native
auth and enabled PostgreSQL `/logout-all` also use the same authenticated atomic
service, preserving their 204/cookie-clear response. The generic trusted
`AuthService.revokeAll(userId)` remains available to trusted application code.

Malformed input is 400, unauthenticated/expired/stale initiation is 401, untrusted
Origin is 403, and storage failures remain server failures. Errors/results expose
no raw token, digest, credential, user identifier or other-account data. Server
failures/network loss may leave commit outcome uncertain. Never automatically
resubmit: a later action may include new sessions. Browser guidance is in
[console controls](console-session-controls.md).

See [service](session-controls.md), [SQLite](sqlite-session-controls.md),
[PostgreSQL](postgres-session-controls.md), [cookies](auth-http.md) and
[verification](session-controls-testing.md).
