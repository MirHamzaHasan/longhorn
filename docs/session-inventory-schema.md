# Session reference schema upgrades

Owners: sqliteSessionInventoryMigrations and postgresSessionInventoryMigrations.
Connects [SQLite](sqlite-session-inventory.md), [PostgreSQL](postgres-session-inventory.md),
[owner migrations](migrations.md) and [verification](session-inventory-testing.md).

Append the feature after the application's complete previous manifest. The SQLite
auth example appends after its notes migration. The command application appends
after longhorn_rate_limit/001_buckets, preserving every earlier operations ID,
statement, order and checksum. Never insert it into an already deployed base
manifest before later application features.

| Provider | Migration ID | Reference creation |
| --- | --- | --- |
| SQLite | longhorn_auth/002_session_inventory | Native randomblob backfill and AFTER INSERT trigger |
| PostgreSQL | longhorn_postgres_auth/004_session_inventory | NOT NULL native gen_random_uuid default, with backfill |

Both add session_id, a unique reference index and (user_id,expires_at,session_id)
paging index. Existing token hashes, users, expiry and password/session protocols
remain unchanged. SQLite adds a nullable checked column so old inserts can omit
it; its trigger fills an omitted/NULL reference inside that same statement and
transaction. Committed framework-created rows therefore have valid references.
PostgreSQL's native default fills references for existing rows and later inserts,
including the unchanged privileged password-session function.

No existing AuthStore writer, SessionManager method, stored-session type or password
function definition is rewritten. No new runtime DML grant is required. The
PostgreSQL host checks the new column and required existing lock/native UUID
function execution before enabling the capability. Owner credentials alone deploy
DDL; HTTP never repairs schema. The auth example retains its lifecycle-owned
migration pattern, while the command app retains separate owner deployment.

A failed suffix rolls back column/index/trigger/default work and history together.
Native gates start the actual old profiles/sessions, fail a suffix, then upgrade
and verify stable legacy hashes/expiry plus new references. Backups retain the
references with session rows. Keep complete code/schema profiles together on
upgrade; an older migrator may reject newer history rather than support downgrade.
Do not delete migration records or session rows to make an old profile start.
