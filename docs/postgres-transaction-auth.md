# PostgreSQL transaction authentication locks

Owner: `PostgresAuthStore` and `postgresAuthTransactionMigrations` from
`@longhornjs/auth/postgres`. Connects [transaction authentication](transaction-authentication.md),
[migration history](postgres-migrations.md), [runtime roles](postgres-roles.md)
and [operations provisioning](operator-provisioning.md).

Append the separate migration list after the application's complete deployed
history. It adds `longhorn_postgres_auth/002_transaction_auth`; the original
users/sessions migration is unchanged. The account operations example provides
an explicit complete deployment profile. Grant the intended runtime role:

```sql
GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO your_app;
```

The function accepts only a SHA-256 token hash and returns public user columns
plus session metadata. It takes a user FOR SHARE lock, then a session FOR SHARE
lock, retained by the caller's transaction. Direct role UPDATE and session DELETE,
including ordinary logout, wait on those locks. Trusted provisioning takes the
user lock before session deletion in the same order. A role change winning first
is observed after the wait; a retry winning first commits before revocation.

This narrow SECURITY DEFINER function avoids granting runtime UPDATE on users just
to acquire row locks. It has static fully qualified SQL, search_path pg_catalog
then pg_temp, and PUBLIC execution revoked. Deploy with the nonsuperuser schema
owner; grant EXECUTE explicitly. VOLATILE preserves fresh snapshots between its
internal queries after lock waits. No password column is projected. These choices
follow PostgreSQL's [function security](https://www.postgresql.org/docs/18/sql-createfunction.html),
[row locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)
and [volatility](https://www.postgresql.org/docs/18/xfunc-volatility.html) contracts.

Keep transactions short and await only local policy/SQL work. Database timeouts
and deadlock detection can roll back contended actions; there is no automatic
retry of arbitrary business code. This is application authorization coordination,
not tenant RLS or protection against a database owner. Native tests inspect the
function privileges/configuration, retain denied user UPDATE, observe actual lock
waits, and kill a transaction holder before commit.
