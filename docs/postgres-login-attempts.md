# PostgreSQL login-attempt windows

Owner: LoginAttemptStore methods and explicit cleanup on PostgresAuthStore.
Connects [AuthService](authentication.md), [credential storage](auth-postgres.md),
[PostgreSQL transactions/pooling](postgres.md) and [account HTTP](postgres-accounts.md).

AuthService hashes the normalized username into a key and reserves an attempt
before credential verification. The default is ten attempts per fixed fifteen-minute
window. One PostgreSQL INSERT ON CONFLICT DO UPDATE locks/updates that key atomically:
an expired window resets to one with a new expiry; an active window increments and
saturates at limit+1. RETURNING reports the committed count/window. No read-then-write
race or process-local counter is used. Distinct keys do not require a global lock.

At exactly now==expires_at, the next reservation starts a fresh window. A blocked
reservation returns the existing window end, and AuthService maps it to RATE_LIMITED;
HTTP returns 429 with Retry-After. Successful credential verification clears the key.
Policies/clocks should agree across hosts. Overlapping successful logins can clear
reservations as part of that existing reset policy; this is not a security audit log.

Schema fields are key text primary key, attempts integer (1–1001) and constrained
bigint expiry. The store accepts bounded policies matching AuthService (limit
1–1000, window 1000–86400000 ms), with safe nonnegative times. Runtime needs
SELECT/INSERT/UPDATE/DELETE. The coordinator normally passes hashed keys; low-level
inputs remain trusted application calls.

Unlike SQLite's per-attempt global cleanup, PostgreSQL's hot path only touches its
key. Expired distinct keys therefore remain until reused, cleared after success,
or explicitly maintained:

```ts
const removed = await store.deleteExpiredLoginAttempts(Date.now(), 1000)
```

This PostgreSQL-specific method defaults to at most 1000 rows, accepts limits 1–10000,
and uses the (expires_at,key) index with FOR UPDATE SKIP LOCKED. Concurrent maintenance
can process separate rows without deleting locked/active windows. The result is the
number removed, not a total remaining count. Call it from an owned maintenance host
with its own cadence/backlog policy; no scheduler is installed by auth storage.

This is account-based throttling. IP/distributed edge limits, signup abuse controls,
credential-stuffing detection and account lockout policy remain separate. A caller
can consume a public handle's window; this policy alone does not prevent denial of
service. [Native tests](postgres-auth-testing.md) prove shared limits, saturation,
boundary reset and bounded cleanup, including two real reservation processes.
The atomic path follows [PostgreSQL ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT).
