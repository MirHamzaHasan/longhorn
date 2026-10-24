# Password changes and session revocation

Owner: POST `/auth/password` in `src/app.ts`, AuthService and the native SQLite
password-store capability. The generated app explicitly enables changes.

Send strict JSON `{ "currentPassword": "...", "nextPassword": "..." }` with the
authenticated cookie and exact configured Origin. The next password follows the
15–128 Unicode-code-point registration policy and must differ from current input.
Whitespace/Unicode are preserved. User IDs, roles and encoded hashes are rejected.

The current password is verified and the replacement derived outside SQL locks.
At transaction ownership the store rechecks the copied credential, initiating
session and current expiry. Hash replacement, every subject-session deletion and
attempt clearing commit together. Success is 204 with the cookie cleared; sign
in again with the new password. Roles, notes and other users remain intact.

Wrong current credentials return 401 without clearing a still-valid session.
Reauthentication shares the durable account attempt limit with login (429 and
Retry-After when blocked). Input errors are 400 and native capacity is 503.
SQL failures roll back; an uncertain commit is not automatically replayed.

Current stores also fence session creation against the expected credential, so an
old-password verifier already running cannot issue a session after replacement.
Stop/upgrade every old login writer sharing the file before enabling this flow.
Raw SQL and trusted low-level session APIs do not automatically honor that protocol.
The original SQLite schema needs no new migration. This feature is authenticated
change, not forgotten-password recovery, email reset or MFA.

`pnpm test` covers the HTTP policy with explicit fake passwords and real native
SQLite. `pnpm test:persistence` uses actual native hashing and two HTTP processes
to check password replacement, all-session revocation, retained notes and restart.
See [passwords](passwords.md), [sessions](sessions.md), [HTTP](http.md),
[lifecycle](lifecycle.md) and [testing](testing.md).
