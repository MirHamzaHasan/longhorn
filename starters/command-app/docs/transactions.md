# Managed transactions and identity

Owner: @longhornjs/database, @longhornjs/auth/postgres and src/operations.ts. A managed
executor belongs to one database and expires after its transaction callback.
Idempotency, outgoing enqueue, business writes and authorization use that same
scope. The narrow auth function locks the current user/session until commit,
checks expiry after waiting and exposes no password hash to authorization.

Provisioning owns the fixed-search-path SECURITY DEFINER function; PUBLIC execution
is revoked and runtime EXECUTE is explicit. Runtime users cannot update roles.
Connects [accounts](accounts.md), [commands](commands.md), [recovery](recovery.md)
and [schema](schema.md). External publishing happens after commit.
