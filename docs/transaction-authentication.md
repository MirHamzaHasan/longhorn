# Authentication within a business transaction

Owner: `AuthService.authenticateInTransaction` in `@longhornjs/auth`. Connects
[sessions](sessions.md), [managed executors](transaction-executors.md),
[SQLite auth](auth-sqlite.md), [PostgreSQL locking](postgres-transaction-auth.md)
and [authorized recovery](outbox-authorized-retry.md).

```ts
await database.transaction(async tx => {
  const principal = await accounts.authenticateInTransaction(tx, sessionToken)
  if (!principal?.user.roles.includes('numbers-operator')) throw new Error('Forbidden')
  // Await protected SQL work through this same transaction.
})
```

This optional store capability reads the current session and public user while
retaining native authorization ownership until commit or rollback. It requires
the exact Database instance used by the auth store. Root, expired, foreign and
fabricated executors fail; unsupported stores throw instead of falling back to
an ordinary request lookup. Missing/malformed tokens return undefined.

The service hashes the opaque token, awaits the locked projection, then checks
expiry against its clock. A token expiring during a lock wait cannot authorize
new work. The result freezes user/roles and session expiry, excluding token,
token hash and password hash. This path performs no password work or network calls.
Expired-row cleanup stays separate to avoid upgrading shared read locks.

SQLite uses its managed write transaction to serialize writers. The same store
runs over Object SQLite, whose transaction/input gate supplies ownership.
PostgreSQL uses an explicitly deployed lock function. Existing ordinary
authenticate/cookie guards still authorize at request admission; in-flight reads
are not cancelled by later revocation. Call the transactional method for SQL
mutations that need coordination with session deletion or role changes.

Source tests use real SQLite. [Native verification](operator-accounts-testing.md)
proves PostgreSQL row contention, expiry after waiting, process rollback and actual
Object SQL authorization/abort behavior. No external identity provider is added.
