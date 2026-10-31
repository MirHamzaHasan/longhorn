# Active session inventory

Owner: optional `@longhornjs/auth/session-inventory`. Connects existing opaque
[sessions](sessions.md), [SQLite](sqlite-session-inventory.md),
[PostgreSQL](postgres-session-inventory.md), [HTTP](session-inventory-http.md),
[Account controls](console-session-inventory.md) and [native proof](session-inventory-testing.md).
AuthStore, SessionStore, SessionManager, AuthService and their login/password APIs
retain their existing contracts. This is a separate explicitly acquired capability.

```ts
import { SessionInventory } from '@longhornjs/auth/session-inventory'
import { SqliteSessionInventoryStore } from '@longhornjs/auth/sqlite-session-inventory'
const inventory = new SessionInventory(new SqliteSessionInventoryStore(database))
const page = await inventory.list(currentToken, { limit: 10 })
// {sessions:[{id, expiresAt, current}], nextCursor:string|null}
const result = await inventory.revoke(currentToken, page.sessions[0]!.id)
// {revokedSessions:0|1, current:boolean}
```

Deploy the [appended schema](session-inventory-schema.md) first. References are
independent public 32-character lowercase hex IDs, not bearer tokens, token hashes,
device fingerprints or authorization credentials. An authenticated owner can see
only that owner's live sessions. No caller-selected user or operator-wide view is
accepted. Expiry/current status are the available metadata; creation time, device,
IP, location and browser identity are neither collected nor inferred.

Limits default to 10, bounded 1..50; queries fetch at most limit+1 rows. Results use
[expiry/reference keysets](session-inventory-cursors.md), not an offset or a snapshot.
Every operation hashes a valid current token, reauthenticates under native ownership
and samples its trusted clock exactly once afterwards. Frozen input/options and
captured store methods prevent asynchronous substitution. Malformed provider
observations fail closed, and output copies only public fields.

Selected revocation deletes at most one live owned row, publishes after commit and
reports whether it was the initiating session. Missing, expired, previously removed
or foreign targets all return zero while initiation remains valid. Invalid/expired/
revoked initiation returns INVALID_CREDENTIALS and makes no mutation. Native errors
retain identity. Ending the initiating session makes later calls unauthorized;
other valid sessions and future password logins keep their existing policy.

This capability owns no connection, timer or cleanup loop. Await calls before
releasing the borrowed database; [HTTP lifecycle](session-inventory-lifecycle.md)
drains accepted calls. It does not change passwords, revoke future logins, purge
expired rows or replace the existing [others/all controls](session-controls.md).
