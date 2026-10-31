# SQLite session inventory store

Owner: optional `@longhornjs/auth/sqlite-session-inventory`. Connects
[portable service](session-inventory.md), [schema](session-inventory-schema.md),
[SQL transactions](database.md) and [native proof](session-inventory-testing.md).

SqliteSessionInventoryStore borrows the existing managed Database. A transaction
joins the initiating session to its user, then samples the supplied synchronous
clock after native ownership. Missing/deleted-user/expired initiation returns no
result and performs no deletion. A bounded SELECT projects only session_id, expiry
and the current marker under the authenticated owner. GET/list does not initialize
references, update rows, extend expiry or prune expired sessions.

The separate appended migration backfills native random references once and
installs an AFTER INSERT trigger. Legacy SessionManager/AuthStore/password inserts
still supply their original fields. New references commit with those inserts;
failed insertion/migration rolls them back. SQLite's nullable intermediate column
supports that trigger; a malformed committed reference from a trusted raw SQL
writer fails closed rather than being silently repaired on a read.

Selected deletion filters owner, reference and expiry under the same transaction.
The bounded RETURNING projection determines its actual result and current marker;
libsql can report rowsAffected=0 even when that projection contains a deleted row.
No decision escapes before commit. A later injected failure rolls back deletion
and propagates its original identity. Native write ownership also serializes
reciprocal controls before reauthentication, avoiding stale initiating sessions.

Actual Node/Bun/Deno adapters prove upgrades, reference generation, pages, rollback,
post-wait clock/expiry and process death before/after commit. Pinned workerd proves
real Object SQLite trigger/reads/rollback/revoke and queued input-gate expiry.
The store does not acquire or close its borrowed database/platform binding.
