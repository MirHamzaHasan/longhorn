# SQLite password/session transactions

Owner: `SqlitePasswordStore` from `@longhornjs/auth/sqlite-passwords`, exposed by
`SqliteAuthStore.passwordChanges`. It borrows the same existing `Database`, with
no new connection, timer, migration or table. Native Node/Bun/Deno providers supply
the managed callback transaction; the auth store imports no native driver.

Conditional session issuance starts a write transaction, checks the expected user
hash, inserts the hash-only session, rotates the supplied prior hash and clears the
attempt key. A mismatch returns false before writes. A native failure rolls back
all those changes, including prior-session preservation.

Replacement starts a managed transaction, joins the initiating session to its exact
user and checks the expected credential. The trusted synchronous clock runs after
ownership, so a session that expired while waiting cannot replace the password.
Hash update, all-user-session deletion and attempt clearing commit together.
Roles and other users' rows are not updated. Inputs and nested session candidates
are validated/copied before admission; native row expiry must be a safe timestamp.

The original auth and note migrations/checksums remain unchanged. Same-file Native
SQLite locking supplies cross-process ordering; the providers' canonical-file gates
also coordinate handles in one process. Hashing/verification happens before this
short database interval. No async native KDF is hidden inside a SQL callback.

Real Node SQLite tests cover trigger-induced rollback after the hash write,
duplicate-insert rollback, failed conditional rotation, input mutation during
admission and expiry behind a held same-file transaction. Native crash/drain and
mixed runtime checks are recorded in [password verification](password-change-testing.md).
See [policy](password-changes.md), [session fencing](password-session-fencing.md)
and [native auth hosts](native-auth-example.md).
