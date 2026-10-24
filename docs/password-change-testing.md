# Password-change verification

Owner: source policy/provider tests, `scripts/verify-password-changes.mjs`, the
extended native auth verifier and generated auth persistence checks.
The local native profile is Node 20.19.4, Bun 1.4.4, Deno 2.9.6 and PostgreSQL 18.4
on macOS ARM64. Hosted results are recorded independently per commit.

```sh
pnpm test:password-changes
pnpm test:auth-project
```

Source service tests use explicit fake password providers. They verify exact
input, opt-in capability, shared reauthentication throttle, all-session/peer policy,
mutable credential snapshots, old-verifier fencing, concurrent replacement,
post-hash expiry and private conditional session candidates. Real Node SQLite
tests additionally exercise native trigger/insert rollback, input admission copies
and expiry after actual same-file transaction ownership.

The owned PostgreSQL gate deploys the complete operations history with restricted
roles. Six native cases inspect actual function privileges/search paths/owner,
deny direct password/role UPDATE, hold old verification across replacement, reject
a concurrent stale candidate, inject a real rollback trigger and observe a real
server row-lock wait before advancing the service clock past expiry. A current
login-only service also participates in the credential fence.
An actual repeatable-read session default cannot override the native provider's
explicit READ COMMITTED transaction. A nonconforming adapter that selects a
repeatable transaction is rejected before session/password mutation.

Actual Node/Bun/Deno SQLite processes and a restricted PostgreSQL process pause
after native password/session writes but before commit. SIGKILL must roll the whole
operation back: original credentials/session remain usable through a fresh native
client. Temporary protocol files are private and removed after owned child exit.
Separate native HTTP fixtures receive SIGTERM during the real replacement KDF;
the accepted 204, atomic revocation, committed new hash, native work settlement
and application/storage close must complete in order on all three runtimes.

Mixed native SQLite HTTP and real PostgreSQL HTTP check password replacement,
old-password rejection, cookie clearing, cross-process all-session revocation,
peer/note retention, restart and secret-free logs. Raw Node crypto independently
rederives PostgreSQL's stored replacement. Installed auth starters run the copied
seven source cases and their actual native persistence/password-change flow after
packing, relocation and unchanged frozen installation.

The gate owns temporary files/databases/processes only. No production credentials,
normal data, cloud reset service or Worker native KDF is involved. The
[runtime matrix](supported-runtimes.md) and exact-head PR checks govern OS/hosted
claims. See [policy](password-changes.md), [issuance](password-session-fencing.md),
[SQLite](sqlite-password-changes.md), [PostgreSQL](postgres-password-changes.md)
and [HTTP](password-change-http.md) for the boundaries.
