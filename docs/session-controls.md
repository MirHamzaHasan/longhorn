# Authenticated session controls

Owner: `AuthService.revokeSessions` and the optional `AuthStore.sessionControls`
capability from `@longhornjs/auth`. This connects existing opaque tokens and SQL
ownership to two explicit user actions, without accepting a client-selected user.

```ts
const accounts = new AuthService(store, passwords, { sessionControls: true })
await accounts.revokeSessions(currentToken, 'others') // keeps this initiating session
await accounts.revokeSessions(currentToken, 'all')    // includes this session
// Each result is { revokedSessions: number }.
```

Opt-in fails at construction if the store does not support the capability. Legacy
custom AuthStore implementations keep their existing contract. The service binds
the trusted capability at construction, checks exact scope/token format, hashes
the raw token using existing Web Crypto policy and supplies frozen hash-only input.
The store authenticates that token again under transaction ownership, checks the
trusted clock after waiting, and atomically deletes live subject rows. Missing,
revoked, deleted-user or expired initiation fails with INVALID_CREDENTIALS and no
writes. Counts must be nonnegative safe integers; all must include at least one.
No password verification, credential write or login-budget change is involved.

`others` deletes the subject's other sessions with `expiresAt > operationTime`.
`all` deletes every subject session live at that instant, including the initiating
row. Counts exclude expired records; explicit session cleanup remains separate.
Other accounts, passwords, roles, notes, commands and receipts are untouched.
Subsequent authenticated requests observe revocation without a positive cache.
Already accepted operations are not retroactively canceled.

The optional `SessionControlStore.revoke({tokenHash,scope}, now)` contract uses one
borrowed database and returns the count or undefined for invalid initiation. It
must snapshot input before admission, sample the synchronous clock after ownership,
return no effect for invalid initiation, and propagate storage failures. The
application owns database lifetime; the capability owns no connection/timer. See
[SQLite](sqlite-session-controls.md) and [PostgreSQL](postgres-session-controls.md).

A successful overlapping login can create a later session after revocation.
This is not a credential change, future-login ban, session inventory, device/IP
tracking, or guarantee that a stolen password can no longer sign in. Use
[password replacement](password-changes.md) when changing credentials is intended.
Trusted SessionManager/raw-SQL writers remain responsible for their own protocol.
The older `revokeAll(userId)` remains a trusted low-level operation; it is not a
substitute for token-authenticated user controls.

See [HTTP](session-controls-http.md), [browser](console-session-controls.md),
[native verification](session-controls-testing.md), [sessions](sessions.md) and
[feature connections](features.md).

The separate [active-session inventory](session-inventory.md) now supplies bounded
expiry/current pages and selected revocation. Its [Account panel](console-session-inventory.md)
uses the existing bulk controls without changing their policy or interfaces.
