# Authenticated password changes

Owner: `AuthService.changePassword` in `packages/auth/src/credentials.ts`.
It composes the existing password provider, account/session store, durable attempt
policy and optional atomic `PasswordChangeStore` capability. Shared code imports
no native APIs and performs no KDF itself.

```ts
const auth = new AuthService(store, passwords, { passwordChanges: true })
await auth.changePassword(sessionToken, currentPassword, nextPassword)
```

The constructor rejects opt-in when the store lacks the complete capability.
Existing custom `AuthStore` implementations retain their login API without it.
Current SQLite/PostgreSQL stores always provide [conditional session issuance](password-session-fencing.md),
including on login-only hosts where password-change endpoints are disabled.
The mutation itself is explicitly enabled. The store capability borrows the same
account/session database, not a separate connection or session cache.

## Policy and commit

The service requires a valid session and current password. Password input retains
exact whitespace/Unicode. The replacement uses the registration policy of 15–128
Unicode code points, with the existing UTF-8/input bounds; identical current/next
UTF-8 input is rejected, including different JS strings that encode to the same
replacement bytes. Invalid input performs no hash work. Reauthentication consumes
the same durable normalized-account attempt budget as login. Wrong current
credentials return `INVALID_CREDENTIALS`; rate/capacity errors retain their existing
HTTP mappings. No password hash is accepted from a client.

Credential records are copied before awaiting native verification. Current-password
verification and replacement hashing finish outside database locks. The final
operation checks the expected credential and initiating session again after
transaction ownership, samples the trusted clock there, then atomically replaces
the hash, deletes all subject sessions and clears that account's attempt record.
Another password winner, session revocation or expiry rejects the stale operation
without overwriting credentials or partially deleting sessions.

Success returns no session. All devices, including the initiating one, must sign
in again. Other users, roles and private notes are preserved. Storage/commit errors
propagate; there is no automatic replay of an uncertain mutation. Native work is
not canceled on disconnect; application drain retains accepted work through SQL.
Revocation denies later authentication; it does not cancel requests already
accepted. Existing transaction-authenticated mutations share user-row ownership
with PostgreSQL replacement and finish before its exclusive row lock can proceed.

This is authenticated password change, not forgotten-password recovery, password
reset by email, automatic hash upgrades, MFA or a breach-password service. See
[HTTP](password-change-http.md), [SQLite](sqlite-password-changes.md),
[PostgreSQL](postgres-password-changes.md) and [verification](password-change-testing.md).
