# PostgreSQL opaque sessions

Owner: SessionStore methods on PostgresAuthStore, consumed by the shared
[SessionManager](sessions.md). Connects [credentials](auth-postgres.md),
[transactions](postgres-transactions.md), [cookies](auth-http.md) and
[account HTTP](postgres-accounts.md).

longhorn_auth.sessions stores only a SHA-256 token hash, user reference and absolute
bigint epoch-millisecond expiry. The token hash is a primary key constrained to 64
lowercase hex characters. Separate user/expiry indexes support all-device revocation
and cleanup. The user foreign key cascades deletion. Raw 32-byte random bearer tokens
are generated/hashed by SessionManager, delivered once in a cookie, and never stored.

createSession inserts the new record and optionally deletes the previous hash on
one checked-out transaction connection. A constraint/error/callback failure rolls
back both writes. SIGKILL after insertion and old-record deletion also rolls back
the uncommitted replacement; the old session remains usable. Successful rotation
preserves the new record and removes the supplied previous hash atomically.

This is password-authenticated login rotation, not a single-use refresh-token
exchange. Two overlapping valid logins may both issue fresh sessions. A previous
hash is optional; it is not proof of credentials. Revocation deletes the current
hash or all current rows for the authenticated user's ID. Future requests query
the database without a positive cache. Requests already executing are not cancelled,
and an overlapping successful login may issue a new session after revocation.

SessionManager owns format checks, the one-second to 30-day TTL policy and exact
now>=expiresAt rejection. The PostgreSQL store preserves safe integer timestamps
without Date rounding. Expired sessions are removed when accessed. purgeExpired()
explicitly deletes all rows at/before its supplied clock; it can touch many rows and
uses the provider's configured statement/lock timeouts. No timer, sliding expiry,
refresh JWT or scheduled maintenance is installed automatically.

AuthService also reloads current roles/accounts and rejects deleted users. There is
no independent PostgreSQL principal cache or global async request context. Multi-host
clocks and TTL settings must agree. Runtime needs SELECT/INSERT/DELETE on sessions;
it cannot extend expiries through UPDATE under the example's grants.

[Native proofs](postgres-auth-testing.md) cover failed replacement, process death,
exact expiry, session hashing, cross-process rotation/revocation, restart and cascades.
