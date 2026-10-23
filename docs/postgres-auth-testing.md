# Native PostgreSQL account verification

Owner: runtimes/node/src/auth.postgres.test.ts, examples/postgres/src/accounts.postgres.test.ts,
scripts/postgres-auth-checks.mjs and fixtures/postgres-auth.mjs. Connects
[owned native QA](postgres-local.md), [credentials](auth-postgres.md),
[session atomicity](postgres-sessions.md) and [account routes](postgres-accounts.md).

pnpm test:postgres builds production outputs and starts an owned PostgreSQL 18.4
cluster with separate owner/runtime roles. Dedicated suites require the owned-harness
marker and generated URLs. They never select a database from implicit local defaults.
Normal pnpm test remains independent of an external server.

Native store/HTTP tests cover concurrent uniqueness, exact JSONB role parsing,
hash-only sessions, current roles, foreign-key cascades, failed replacement rollback,
window saturation/reset, explicit bounded cleanup, exact expiry, revocation,
unneeded privilege denial, note ownership/cursors, cookie flags, origin checks,
private metadata omission, invalid input and failed-startup pool cleanup.
Fast store/HTTP cases use explicitly named test password providers; these are not
production exports or claims about password security.

The compiled example separately uses the actual native scrypt adapter. Two real
HTTP processes race registration, log in through shared PostgreSQL, rotate/revoke
sessions across hosts, observe updated roles, enforce private note access and preserve
notes/sessions after HTTP restart. A one-second session proves expiry; incorrect and
unknown credentials remain indistinguishable. Shared throttle windows survive
process restart. Stored hashes have independent native salts; raw tokens do not
appear in session rows. Passwords, raw tokens and encoded hashes are checked against
captured process logs.

Two barrier-aligned reservation processes admit exactly the shared configured limit.
A separate process is SIGKILLed after inserting a new session and deleting the old
hash inside one uncommitted transaction. The old record survives, the new record
does not, and a later replacement commits normally. Kills target only owned PIDs.
Finally blocks drain/close hosts, pools and the temporary cluster.

These are native macOS ARM64/PostgreSQL 18.4 proofs. Remote TLS/failover/poolers,
production throughput, RLS and advanced account lifecycle remain separate work.
Existing auth/workerd tests still verify portable contracts; PostgreSQL sockets stay
in the Node adapter and no native driver enters the shared auth root entrypoint.
