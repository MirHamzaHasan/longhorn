# Native SQLite session controls

Owner: `SqliteSessionControlStore` from `@longhorn/auth/sqlite-session-controls`,
also exposed as `SqliteAuthStore.sessionControls`. It borrows the same managed
Database as the account store and uses the original auth tables/indexes.
No schema migration, session metadata column or additional connection is needed.

The port snapshots the token digest and exact scope before entering the native
write transaction. Inside ownership it joins the initiating session to its user,
validates the stored subject/expiry, samples the supplied clock, and refuses
expired/missing initiation before any deletion. The user index bounds the subject
predicate. `others` adds token_hash exclusion; both scopes exclude expired rows
from deletion/counts. Raw input, usernames and request-supplied user IDs never
select the deletion owner.

Native Node/Bun/Deno SQLite managed gates cover the read and deletion as one
transaction, including asynchronous admission. Trigger/step/commit failures
propagate and roll back. The new port never retries a SQL statement/transaction.
A crash after deletion but before commit recovers the prior rows when reopened.
Callers must not infer that an uncertain commit failed or automatically replay an
action, because a later attempt can affect newly issued sessions.

The [auth app](native-auth-example.md) and independent [sqlite-auth starters](auth-starter.md)
enable the capability and strict HTTP routes on Node, Bun and Deno. Custom stores
can keep it disabled or implement the optional contract. This is managed native
SQLite evidence, not a claim for D1 batch or a workerd SQL adapter.
See [policy](session-controls.md), [HTTP](session-controls-http.md),
[proof](session-controls-testing.md) and [SQLite auth](auth-sqlite.md).
