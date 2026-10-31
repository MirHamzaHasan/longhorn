# PostgreSQL session inventory store

Owner: optional `@longhornjs/auth/postgres-session-inventory`. Connects
[portable service](session-inventory.md), [session controls](postgres-session-controls.md),
[password ownership](postgres-password-changes.md), [schema](session-inventory-schema.md)
and [verification](session-inventory-testing.md).

The store requires READ COMMITTED. It obtains a subject hint from the initiating
hash, takes the existing auth-password advisory lock for that user, then invokes
the existing privileged lock_session_user projection and joins its immutable public
reference. Only after native ownership does it sample the trusted clock and check
expiry. A deleted/revoked/stale initiator produces no result and no mutation.

The same ownership key joins login/password/session-control protocols. Reciprocal
targeted revocations serialize before acquiring session row locks, so the second
operation reauthenticates rather than deleting from a stale authorization snapshot.
Role changes retain their existing user/session row-lock behavior. Trusted direct
SQL/session writers remain responsible for the shared protocol.

Bounded reads filter exact owner and live expiry and continue through the composite
expiry/reference index. Selected DELETE returns at most one current marker. A
failed query/commit publishes no result; native error identity and rollback remain
with the Database owner. A committed acknowledgement can be lost, so clients must
not infer rollback from transport failure or automatically retry current revocation.

The appended native UUID default/indexes need no new runtime DML. Existing table
SELECT/INSERT/DELETE and lock-session function authority remain sufficient; native
UUID function execution must also be available. checkPostgresSessionInventory is
a read-only startup/readiness probe, not a migration/checksum/privilege repair tool.
Passwords, roles, other accounts, commands, deliveries and replay records are not
changed. The class borrows its existing pool and closes no resource.
