# Credentials and authentication

Owner: `@longhornjs/auth`. Connects a `PasswordHasher`, account storage, login-attempt
storage, and [sessions](sessions.md). Shared code uses Web Crypto and contains no
Node APIs. Explicit [Node](passwords.md), [Bun](bun-passwords.md) and
[Deno](deno-passwords.md) password adapters share the same fixed policy.
The [SQLite store](auth-sqlite.md) is a separate choice; core does not automatically
enable authentication.
The [PostgreSQL store](auth-postgres.md) supplies the same service contracts with native SQL.

```ts
import { AuthService } from '@longhornjs/auth'
import { SqliteAuthStore } from '@longhornjs/auth/sqlite'
import { createScryptPasswordHasher } from '@longhornjs/node/passwords'

const auth = new AuthService(new SqliteAuthStore(database), createScryptPasswordHasher())
const user = await auth.register('alex', 'a long unique passphrase')
const login = await auth.login('alex', 'a long unique passphrase')
const principal = await auth.authenticate(login.session.token)
await auth.logout(login.session.token)
```

Acquire/migrate `database` through application startup and close it after handlers
drain. Share the hasher/service through application DI. See [the auth example](auth-example.md)
for the full path and [HTTP integration](auth-http.md) for cookie delivery.

## Account and credential behavior

Usernames are public handles: trim surrounding whitespace, lowercase, then accept
3–64 ASCII letters/digits/underscore/period/hyphen, starting with a letter or digit.
They are unique in storage. This is a username system, not verified email identity.
Duplicate registration returns `USERNAME_TAKEN`; usernames are not treated as secrets.

Registration accepts passwords of 15–128 Unicode code points, without trimming,
case conversion, or silent truncation. Inputs are bounded before hashing. The hasher
receives the exact password; only its encoded result reaches credential storage.
Registration assigns `member`, with no client-controlled role argument. It returns
only `{ id, username, roles }` and does not automatically log in.

Login performs password verification for both existing and missing accounts. A
`PasswordHasher` must perform dummy work for a missing or malformed hash; the native
adapters do so with the same scrypt parameters. Wrong and unknown credentials
return the same `INVALID_CREDENTIALS` error. Valid login issues a fresh opaque
session. Supplying a previous session token rotates it atomically in storage.

The public user record is explicitly copied and frozen, including its roles. Encoded
passwords and raw tokens are not included in principals. Roles are loaded from
current account storage on every authenticated request; there is no process-local
principal cache. Store failures propagate, rather than silently authenticating or
treating a failed lookup as a missing user.

## Throttling and errors

Default login policy permits 10 attempts per normalized username in a fixed
15-minute window. Keys are SHA-256 username hashes. SQLite reserves attempts in a
write transaction; PostgreSQL uses an [atomic key upsert](postgres-login-attempts.md).
Both retain windows across restarts and share them across processes.
Successful verification clears that account's attempts; a blocked account waits
for the window to end. `loginLimit` and `loginWindowMs` configure bounded policies.
The [HTTP example](auth-example.md) returns 429 with `Retry-After` when blocked.

This is account-based throttling. Public registration, distributed/IP limits,
credential-stuffing detection, and denial-of-service policy remain application or
edge concerns. Account-based limits can themselves be used to lock a handle for
the window. The password adapter separately bounds active work and queued jobs.

`AuthError.code` distinguishes `INVALID_INPUT`, `USERNAME_TAKEN`,
`INVALID_CREDENTIALS`, `RATE_LIMITED`, and `CAPACITY`. Messages contain no supplied
passwords/tokens. HTTP mapping stays outside the root package. The normal request
logger omits request bodies, cookies, and authorization headers.

## Connections, verification, and limits

```text
HTTP validation -> AuthService -> CredentialStore + LoginAttemptStore
                              -> PasswordHasher -> native Node/Bun/Deno scrypt
                              -> SessionManager -> SessionStore
AuthService.authenticate -> session validation -> fresh account -> public principal
```

Service tests cover input bounds, public output, dummy-verification delegation,
rotation, expiry, current roles, missing users, throttling, and store errors.
`pnpm test:auth` verifies actual scrypt, native HTTP, SQLite, process restarts, and
cross-process revocation. Its separate workerd fixture verifies portable contracts
using explicit test-only password/store providers, not a Worker password adapter.
The [native auth gate](native-password-testing.md) adds independent legacy/peer
hashes, actual signal drain and mixed retained hosts.

Opt-in [password changes](password-changes.md) now reauthenticate the current
password and atomically revoke subject sessions. Current SQL stores always use
[credential-fenced issuance](password-session-fencing.md), including login-only
services; legacy custom stores retain their existing basic login contract.

This initial module supplies local credentials and sessions. OAuth/OIDC, passkeys,
MFA, password reset, email verification, recovery, breached-password checks,
and automatic hash upgrades are not implemented. Further sensitive account changes
need their own reauthentication and revocation policies.
The [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
is a reference for that subsequent work.
