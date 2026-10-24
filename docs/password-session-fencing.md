# Session issuance against the current credential

Owner: `SessionManager.createIf`, `AuthService.login` and the password-store ports.
A password verifier can still be running when another request changes the password.
Deleting existing sessions alone would let that old verifier create a new session
after replacement. Current SQL stores therefore recheck the copied credential at
the session commit boundary, even when their own change endpoint is disabled.

`createIf(userId, commit, previousToken?)` generates the token privately and passes
a frozen hash-only candidate and optional previous-token hash to a trusted commit
operation. The callback returns true only after its atomic write succeeds. False
must mean no writes: no session insertion, prior-token deletion or attempt reset.
Only true exposes the raw issued token to the caller; errors propagate.
The ordinary `create` API retains its existing trusted store behavior.

AuthService snapshots the account and expected encoded hash before native
verification. After verification, the SQL capability conditionally inserts the
session, rotates any previous token and clears the attempt record in one commit.
A changed/deleted credential fails with the same generic credential error. Native
password work stays outside this short ownership interval.

SQLite's managed write transaction serializes the read/insert with replacement.
PostgreSQL uses a transaction-level shared advisory lock over the namespaced user
ID before reading the current hash. Password replacement takes the matching
exclusive lock before user/session row locks. A login that commits first is
included in the later purge; a login that reaches ownership afterward sees the
changed hash and cannot issue an old-password session. Advisory hash collisions
only add serialization; the SQL still checks the exact user ID and credential.
[PostgreSQL documents transaction advisory locks and their lifetime](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

The PostgreSQL port explicitly requires READ COMMITTED inside each managed operation.
It fails closed on other isolation settings, because a repeatable snapshot taken
before lock admission could retain a prior credential. READ COMMITTED takes a new
statement snapshot after the wait; see [PostgreSQL isolation semantics](https://www.postgresql.org/docs/18/transaction-iso.html).

This is a cooperating writer protocol, not a database-wide credential epoch.
Upgrade/stop every old login host before enabling password changes. Legacy custom
stores, raw SQL and direct trusted `SessionStore`/`SessionManager.create` calls do
not automatically participate. The [capability contract](password-changes.md) must
be honored by every login path sharing the accounts. The
[native gate](password-change-testing.md) holds an old verifier across a real
replacement and proves rejection for a current login-only host too.
