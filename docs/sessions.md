# Opaque sessions

Owner: `SessionManager` from `@longhornjs/auth`. Connects Web Crypto, a `SessionStore`,
[credentials](authentication.md), and [cookie delivery](auth-http.md). It does not
read cookies or own HTTP, timers, database connections, or process signals.

```ts
const sessions = new SessionManager(store, { ttlMs: 8 * 60 * 60 * 1000 })
const issued = await sessions.create(userId, previousToken)
const session = await sessions.authenticate(issued.token)
await sessions.revoke(issued.token)
await sessions.revokeAll(userId)
await sessions.purgeExpired()
```

## Tokens, expiry, and ownership

Every issued token uses 32 cryptographically random bytes, encoded as 64 lowercase
hex characters. Storage receives the SHA-256 token hash, user ID, and absolute
expiry in epoch milliseconds. The raw token is returned once for delivery to the
client and is not persisted. Malformed tokens fail before a store lookup; tokens
from URL parameters or bearer headers are not accepted by the cookie middleware.

The default absolute lifetime is eight hours, configurable from one second to
30 days. Authentication does not extend it. At `now >= expiresAt`, the session is
rejected and removed. There is no idle timeout, rolling renewal, JWT, refresh token,
or per-process positive cache. An injected clock supports deterministic tests;
normal execution uses `Date.now`.

`create(userId, previousToken)` generates a new token and asks the store to insert
it and revoke the previous hash atomically. The SQLite/PostgreSQL implementations preserve
the old session if replacement fails. Login never adopts a client-chosen token.
Logout deletes the current hash; all-device revocation deletes that user's records.
Subsequent requests in every process observe the change. Requests already executing
are not retroactively cancelled by revocation.

`AuthService.authenticate` additionally reloads the current user, rejects deleted
accounts, and exposes only a public user plus expiry. `SessionManager.authenticate`
alone validates the stored session record; consumers using it directly must perform
their own account/status checks.

## Store contract

`SessionStore` owns `createSession`, `findSession`, `deleteSession`,
`deleteUserSessions`, and `deleteExpiredSessions`. A store must preserve atomic
replacement, uniqueness, durable revocation, and appropriate user references. The
[SQLite implementation](auth-sqlite.md) uses indexed token hashes and expiry, with
foreign-key deletion for accounts.
The [PostgreSQL implementation](postgres-sessions.md) uses the same contract and
verifies replacement rollback through real process death.

Expired sessions are deleted on access. `purgeExpired()` is an explicit maintenance
operation; no scheduler or isolate cleanup callback is implied. Applications can
schedule it later through their own lifecycle-owned maintenance process.

Hash-only storage reduces the value of a read-only session-table disclosure; it
does not protect stolen browser cookies or an attacker who can modify the store.
Cookie flags and origin checks are covered separately in [HTTP auth](auth-http.md).
See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Verification

Unit tests cover token format, absence of raw tokens in storage, atomic rotation,
expiry boundaries, revocation, user deletion, invalid tokens/clocks, and propagated
store errors. SQLite tests use multiple connections and failed replacement writes.
`pnpm test:auth` verifies actual process restarts, cross-process revocation, expiry,
and portable session execution in workerd.

Authenticated others/all revocation is recorded in [session controls](session-controls.md).
