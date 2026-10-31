# Restricted PostgreSQL password changes

Owner: `PostgresPasswordStore`, `postgresPasswordMigrations` and
`postgresPasswordFunctions` from `@longhornjs/auth/postgres-passwords`.
`PostgresAuthStore.passwordChanges` borrows that store's database. Its default login
fence uses existing table privileges plus built-in transaction advisory locks;
it needs no new function migration or user UPDATE permission.
Both password/session operations explicitly require READ COMMITTED transaction
isolation and reject other settings before writing. There is no unsafe fallback
to an old repeatable snapshot after advisory admission.
The native Node provider already pins managed transactions to READ COMMITTED;
the extra guard also covers separately supplied Database implementations.

Password replacement is opt-in. Append `postgresPasswordMigrations` after the
application's complete deployed history, then grant only the two exported function
signatures to the restricted runtime role. The operator deployment appends it after
the original operations/command-history prefix; earlier statements/checksums are
unchanged. The normal PostgreSQL example keeps its existing history and does not
enable the password endpoint automatically.

```ts
// Deploy with owner credentials, preserving the complete existing prefix.
await migratePostgres(owner, [...completeDeployedHistory, ...postgresPasswordMigrations], { schema: 'app_history' })
const auth = new AuthService(new PostgresAuthStore(runtime), passwords, { passwordChanges: true })
```

## Ownership and grants

`lock_password_change(text,text)` takes the namespaced exclusive transaction advisory
lock, locks the user before the initiating session and returns only the credential
snapshot/expiry needed by the adapter. The adapter samples the service clock after
that wait. `replace_password(text,text,text,text,bigint,text)` repeats the guard and
atomically updates the hash, deletes subject sessions and clears attempts. Both
functions participate in the caller's transaction; a trigger/error or rollback
cannot leave half a replacement.

Both functions are volatile security definers owned by the nonsuperuser migration
role, with qualified objects, fixed `search_path=pg_catalog,pg_temp`, static SQL and
PUBLIC execution revoked in the same migration. The runtime receives explicit
EXECUTE, not users/password/roles UPDATE. The operator runtime check still rejects
direct user/audit mutation authority. Startup/readiness checks require the enabled
functions and grants. This follows PostgreSQL's guidance on
[security-definer search paths and privileges](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

These are trusted server capabilities, not per-account database RLS. AuthService
performs current-password verification outside SQL; clients cannot submit hashes
or user IDs to the HTTP mutation. Database owners/raw writers can bypass service
policy. Row locks, maintenance and other writers can still produce ordinary
transaction/deadlock errors; the adapter rolls back and does not replay SQL.

Before enabling, stop old login writers, retain a stopped-state backup, deploy the
complete appended history, apply runtime grants and start upgraded hosts using the
[credential fence](password-session-fencing.md). Restore procedures revoke PUBLIC
auth execution and reapply the current explicit grant list.
The restored credential/session state is the checkpoint's state; an older backup
can therefore restore pre-change credentials and tokens. See
[operator deployment](persistent-operator-host.md) and
[native proof](password-change-testing.md) for execution evidence.
