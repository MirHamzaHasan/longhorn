# Authenticated password changes

Owner: POST `/account/password` in the account API, AuthService and its PostgreSQL
password capability. The operator host enables the route. The console currently
has no password-settings screen; this is the guarded HTTP API.

Send strict JSON `{ "currentPassword": "...", "nextPassword": "..." }` with the
session cookie and exact configured Origin. The replacement follows registration
policy (15–128 Unicode code points) and must differ from current input. Clients
cannot select a user/role or submit a hash. Native verification/derivation runs
outside SQL locks.

At commit the store rechecks the current credential, initiating session and expiry.
Replacement, all subject-session deletion and attempt clearing commit together.
Success is 204 with the cookie cleared; sign in again with the new password.
Other accounts, roles, notes, commands and audit data remain. Reauthentication
shares the durable account throttle; a wrong current password does not itself
revoke a valid session. Errors never return password/hash data.

The complete migration list appends two hardened functions after the original
history. Deploy with the owner and run `pnpm provision:runtime ROLE` to grant only
their EXECUTE capability; direct users/password/roles UPDATE remains excluded.
Functions fix their search path and revoke PUBLIC execution. Offline restore
revokes PUBLIC auth execution and requires the same explicit runtime regrant.

Current login commits use matching shared advisory ownership and expected-hash
checks, so an old verifier cannot issue a session after replacement. Stop/upgrade
every old login writer sharing the accounts before enabling mutation. Raw SQL and
trusted low-level session APIs do not automatically join this protocol. There is
no email reset/recovery, MFA or automatic hash-upgrade flow here.

See [accounts](accounts.md), [schema](schema.md), [deployment](deployment.md),
[backup](backup.md) and [features](features.md). The independent distribution gate
verifies password replacement after an actual restore/regrant, native revocation,
preserved account history/peer session and retained host restart.
