# Sign-in controls

Owner: src/accounts.ts, console/app.ts and the optional AuthService/PostgreSQL
session-control capability. Open Account after sign-in. End other sessions keeps
this browser signed in; Sign out everywhere includes it and opens sign-in.
The real API is POST `/account/sessions/revoke` with strict `{ "scope": "others" }`
or `{ "scope": "all" }`. It returns a live-session count, clearing the cookie for
all. No client-selected user, role or session digest is accepted.

The operator host enables the capability and verifies EXECUTE on the existing
`longhorn_auth.lock_session_user(text)` function. The complete schema and runtime
provisioning already deploy/grant it. There is no additional migration or direct
user/session UPDATE privilege. The store requires READ COMMITTED, joins the existing
login/password advisory protocol before user/session row locks, reauthenticates the
initiating token and checks expiry after ownership before atomic scoped deletion.

Counts exclude expired rows. Other accounts, credentials, roles, notes, commands
and receipts remain. Already accepted work is not canceled; successful later logins
remain possible. This feature has no device/IP inventory or future-login ban.
Use [password changes](password-changes.md) when changing credentials is intended.

Session/password actions share one pending operation across navigation. Password
fields clear when an action starts. Other account actions, login and logout wait
until it settles. Late responses cannot restore departed forms. A lost/timed-out
response is unconfirmed: sign in to check the account. No automatic retry is sent;
local UI clearing alone does not prove a valid server session was revoked.

The relocated archive gate uses both shipped buttons after actual offline restore,
function regrant and restart. It verifies retained current-browser history,
operator isolation and all-device cookie clearing. Repository native gates also
prove concurrency, post-wait expiry, actual trigger rollback and recovery after
SIGKILL before commit on SQLite runtimes and PostgreSQL. Browser evidence uses
Chromium; physical-device assistive technology/other engines remain manual.
See [account](account.md), [schema](schema.md), [accounts](accounts.md),
[backup](backup.md) and [feature connections](features.md).
