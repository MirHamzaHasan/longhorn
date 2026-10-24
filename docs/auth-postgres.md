# PostgreSQL credential storage

Owner: PostgresAuthStore and postgresAuthMigrations from `@longhorn/auth/postgres`.
Connects [AuthService](authentication.md), [PostgreSQL](postgres.md),
[sessions](postgres-sessions.md), [login attempts](postgres-login-attempts.md),
and [the account example](postgres-accounts.md). The entrypoint imports no native
driver, Hono implementation or Node APIs. Core does not enable authentication.

```ts
import { migratePostgres } from '@longhorn/database/postgres'
import { PostgresAuthStore, postgresAuthMigrations } from '@longhorn/auth/postgres'
import { AuthService } from '@longhorn/auth'
import { createScryptPasswordHasher } from '@longhorn/node/passwords'

await migratePostgres(owner, [...deployedMigrations, ...postgresAuthMigrations], { schema: 'app_history' })
const store = new PostgresAuthStore(runtimeDatabase)
const auth = new AuthService(store, createScryptPasswordHasher())
```

Append the migration once to one complete owner-deployed history. Fixed schema
longhorn_auth contains users, sessions and attempts. All applications sharing that
schema share account names/session/throttle state. The store borrows Database; the
host owns connections, migrations, runtime privileges and shutdown after work drains.
Known non-PostgreSQL dialects are rejected before SQL. This is native $n SQL, not a
translation of the SQLite store.

Users have a nonempty text primary-key ID, normalized username, encoded password
hash and JSONB role array. AuthService generates UUID IDs, normalizes public handles,
validates exact password input, and assigns member without a client role parameter.
The schema independently constrains ASCII normalized handles and uses C collation
for username uniqueness. One INSERT ON CONFLICT(username) DO NOTHING makes concurrent
registration return one winner. Other SQL errors propagate.

findUserByUsername returns credential data only to the service/hasher.
findUserById explicitly omits password_hash. Roles are parsed from the driver's JSONB
text and checked for nonempty strings on every read; malformed persisted roles fail
closed as a storage error. AuthService copies/freezes public principals and reloads
roles for each authentication; the store installs no account/session cache.

The schema checks a JSON array shape, not every role's domain meaning. Trusted role
changes use [operator provisioning](operator-provisioning.md). Password resets/upgrades, account disable/delete APIs, email identity,
OAuth, passkeys and MFA remain separate work. SQL access to credentials is trusted;
storage encryption/backup/network policy belongs to deployment. Hashing uses the
existing [native password adapter](passwords.md), outside this storage module.

Runtime needs users SELECT/INSERT, sessions SELECT/INSERT/DELETE and attempts
SELECT/INSERT/UPDATE/DELETE, plus schema USAGE. User UPDATE/DELETE, session UPDATE,
schema CREATE and migration history access are not needed by the implemented API.
The [role guide](postgres-roles.md) gives concrete grants. These table privileges
are not per-account row-level authorization; private HTTP data uses explicit owner
filters documented separately.

Current store-backed logins now use [conditional credential commits](password-session-fencing.md)
through the borrowed password capability without additional table mutation grants.
Authenticated [password replacement](postgres-password-changes.md) is separately
enabled with two appended owner-deployed functions and specific EXECUTE grants.
The original base schema/history remains intact.

[Native tests](postgres-auth-testing.md) verify uniqueness, live roles, malformed
roles, cascades, atomic sessions, shared throttles and actual scrypt HTTP processes.
Schema invariants follow [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html).
