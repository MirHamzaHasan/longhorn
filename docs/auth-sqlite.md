# SQLite authentication storage

Owner: `SqliteAuthStore` and `authMigrations` from `@longhornjs/auth/sqlite`. Connects
the portable [database contract](database.md) to credential, session, and login-attempt
stores. It imports no native driver. The verified connection provider is
[`@longhornjs/node/sqlite`](sqlite.md).

```ts
import { migrate } from '@longhornjs/database'
import { authMigrations, SqliteAuthStore } from '@longhornjs/auth/sqlite'

await migrate(database, [...authMigrations, ...applicationMigrations])
const store = new SqliteAuthStore(database)
```

Compose a single ordered migration history for each database. Do not call separate
feature migration runners against the same `longhorn_migrations` table. Preserve
the applied prefix and checksums when adding features. A database already running
other migrations must retain them first, then append the new auth migrations.
See [migrations](migrations.md).

## Tables and invariants

| Table | Stores | Boundaries |
| --- | --- | --- |
| `longhorn_auth_users` | UUID, normalized unique username, encoded password, roles JSON | Public outputs explicitly exclude the password hash |
| `longhorn_auth_sessions` | SHA-256 token hash, user reference, epoch-millisecond expiry | Primary-key lookup, indexed user/expiry, cascade on user deletion |
| `longhorn_auth_attempts` | Hashed username key, bounded attempt count, window expiry | Transactional reservation, indexed expiry, shared across processes |

All SQL values use bound parameters. Tables use SQLite STRICT mode. Role JSON and
returned integer/string values are checked by the adapter; malformed rows fail
closed as storage errors. This is SQLite SQL, not a generic claim of PostgreSQL or
remote provider compatibility.

Session replacement inserts the new record and deletes the prior hash in one write
transaction. Failed insertion preserves the old session. Revocation deletes records;
there is no local authentication cache. User-session and expiry indexes support
all-device revocation and maintenance. Foreign keys require the connection provider
to enable enforcement; the Node, Bun and Deno adapters do so.

Login-attempt reservations delete expired windows, then atomically insert/increment
the account's counter. Counts saturate above the configured limit. Successful
credential verification clears that account's window. The service owns policy and
clock values; storage owns atomicity. Concurrent handles and processes share the
same durable counters.

## Ownership, verification, and limits

`SqliteAuthStore` does not open, migrate, or close a connection. Application startup
owns those steps, and shutdown closes the database after request draining. The
[auth example](auth-example.md) registers `Database -> SqliteAuthStore -> AuthService`
through DI and rolls back acquisition if migrations fail.

Native SQLite tests verify repeated migration, account uniqueness, current roles,
foreign-key deletion, cross-handle revocation, failed replacement rollback, and
concurrent throttling. `pnpm test:auth` additionally runs independent server processes,
restarts them, inspects stored password/session representations, and checks integrity.

The store does not encrypt database files/backups, supply account administration,
or schedule expired-session cleanup. Applications retain file access/backup policy
and can call `SessionManager.purgeExpired()` explicitly. Other storage providers can
implement the same contracts with equivalent atomicity and revocation behavior.
