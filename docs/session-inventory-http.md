# Active-session HTTP endpoints

Owners: the [SQLite auth example](../examples/auth/src/app.ts) and opt-in
[command accounts](../examples/postgres/src/accounts.ts). Connects
[service](session-inventory.md), [cookie auth](auth-http.md),
[viewer binding](console-viewer-binding.md) and [Account UI](console-session-inventory.md).

| Route suffix | Request | Result |
| --- | --- | --- |
| GET /sessions | optional limit=1..50 and cursor | sessions[{id,expiresAt,current}], nextCursor |
| POST /sessions/end | strict JSON {id:32 lowercase hex} | revokedSessions 0 or 1, current boolean |

The standalone prefix is /auth; the command prefix is /account. The existing
POST /sessions/revoke with {scope:others|all} keeps its previous contract. Selected
revocation has its own route and never accepts a client user ID or token hash.
The command app's programmatic accounts.sessionInventory enables its DI token,
HTTP routes and console flag. Omission keeps legacy hosts without those routes.
The shipped operator host enables it after owner deployment. The SQLite example
and generated auth starters include the appended schema and routes.

Existing global body, cookie/origin, authenticated-user and viewer guards precede
the operation. Duplicate/unknown query fields, invalid limits/cursors and malformed
bodies fail with 400. Invalid initiation is 401; an origin denial is 403. Missing,
expired or foreign targets produce the same successful zero result. A current
revocation clears the browser cookie only after commit. Provider failures retain
the normal private HTTP error boundary. Replies use no-store and Vary: Cookie.

No response contains bearer material or token hashes, including inside cursors.
Public references cannot authenticate as cookies. Every page/mutation reauthenticates
under ownership, beyond middleware's earlier check. The command console's expected
viewer header also prevents a cookie-switched stale page from acting as another
account. There is no admin-wide inventory, device/IP collection, password change,
automatic cleanup, bulk-policy change or future-login ban in these endpoints.
