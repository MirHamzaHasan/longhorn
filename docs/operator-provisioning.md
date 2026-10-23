# Trusted operator provisioning and deployment

Owner: auth SQL stores, PostgreSQL role CLI and operations migrations. Connects
[account operations](account-operations.md), [PostgreSQL roles](postgres-roles.md),
[transaction locks](postgres-transaction-auth.md) and [session revocation](sessions.md).

SqliteAuthStore and PostgresAuthStore expose setUserRole(username, role, enabled)
for trusted server tooling. Username normalization matches registration; role
codes are bounded lowercase identifiers. Results are missing, unchanged or
updated with a public user and revokedSessions count. An actual role change and
deletion of all existing sessions commit together. A failure rolls both back.
An unchanged grant/revoke leaves sessions intact. Sign in again after a change.

The example provisions only the numbers-operator application role:

```sh
pnpm operator:postgres grant alice
pnpm operator:postgres revoke alice
```

Supply MIGRATION_DATABASE_URL via environment or the PostgreSQL example's
.env/.env.local files. This command accepts an existing account, never creates
a default operator/password, and prints no credential. Public HTTP has no role
management endpoint. The CLI can use a dedicated nonsuperuser provisioner with
CONNECT, schema USAGE, SELECT(id,username,roles) and UPDATE(roles) on users, plus
SELECT(user_id) and DELETE on sessions. It needs no password_hash access. Native
tests prove these minimal grants and rollback when session DELETE is denied.

Deploy this optional example profile with:

```sh
pnpm migrate:account-operations
```

postgresOperationsMigrations retains the complete legacy PostgreSQL example history,
then appends transaction auth, Outbox/recovery/audit and operator command storage.
Once a deployment uses this profile, use it for subsequent migrations; the normal
shorter migrate:postgres history cannot describe the added state. Neither command
implicitly grants privileges. In addition to the normal runtime grants:

```sql
GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO your_app;
GRANT SELECT,INSERT ON longhorn_pg_example.operator_commands TO your_app;
GRANT USAGE ON SCHEMA longhorn_outbox TO your_app;
GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO your_app;
```

Queue DML stays as before. Runtime user UPDATE, audit UPDATE/DELETE and queue
maintenance DELETE stay denied. The temporary demo owns its random credentials,
cluster and grants; these bootstrap scripts never alter a user's database service.
Application provisioning is not PostgreSQL role creation, tenant RLS or a grant
audit product. Trusted provisioning credentials remain a deployment responsibility.

The [persistent operator host](persistent-operator-host.md) uses a separate
[runtime profile](operator-host-configuration.md), rejects migration credentials
and verifies that its connection cannot provision users or edit audit history.
Use the existing migration/role CLI from a separate provisioning shell.
