# Browser account and password changes

Owner: `examples/postgres/console/app.ts`, `app.css`, `src/console.ts` and the
console configuration in `src/app.ts`. Account is an authenticated `#/account`
route for members and operators. It uses the existing layout, theme tokens and
cookie API; it does not introduce another account store or auth implementation.

Open Account in `pnpm demo:operator-accounts`, `pnpm dev:operator-host` or the
[independent command application](command-app-distribution.md). Enter the current
password, a different new password and confirmation. The browser counts 15–128
Unicode code points, preserves spaces, compares exact UTF-8 input and checks the
confirmation before sending strict `{currentPassword,nextPassword}` JSON to
POST `/account/password`. The server remains authoritative for all input policy,
current-password verification, throttling and atomic credential/session writes.
See [HTTP](password-change-http.md) and [service](password-changes.md).

The public shell exposes only a boolean `data-password-changes` capability from
`accounts.passwordChanges`, never request input, secrets or connection settings.
Custom hosts that have not enabled/deployed the capability show the account page
without a password form. Showing the form does not grant the capability: the
server still owns routing, current principal and PostgreSQL function grants.

## Outcomes and navigation

| Outcome | Browser behavior |
| --- | --- |
| 204 | Clear private account UI; show sign-in with a persistent success notice. All prior subject sessions ended; there is no automatic login. |
| 401 with a fresh valid session for the same subject | Explain that the current password was incorrect; keep that verified account signed in. |
| 401 whose session probe fails or identifies another subject | Clear private UI and require sign-in. Never assume that a 401 means only a mistyped password. |
| 400 | Show a password policy error and focus the new-password field. |
| 429 | Keep the session; show the server's bounded integer Retry-After as rounded-up minutes when available. No automatic retry. |
| 403 | Explain that the request was refused and ask the user to reload. |
| Network loss, 15-second deadline, unexpected success status or other failure | Say the change could not be confirmed; require sign-in, suggesting the new password and then the previous one if needed. Never claim the original password was retained or replay the mutation. |

A 401 session probe is a fresh read across navigation, with its own 15-second
request deadline. Ordinary protected requests retain the global sign-out-on-401
behavior; only password reauthentication and its explicit session probe bypass
that automatic branch. An uncertain outcome clears the local UI; it is not proof
that the server revoked a still-valid session or canceled accepted work.

Only one browser password mutation is admitted at a time. Submission, a reentered
account form, sign-in/registration and Sign out stay disabled until it settles.
Navigation remains usable. Late success clears private UI even after navigation;
a late rejected attempt reports on the current route without restoring the old
form. Reads from earlier routes remain cancellable. A browser abort does not undo
native password work already accepted by the server.

Password controls are cleared immediately after fetch serializes the request,
on every outcome, on navigation and on pagehide. A page restored from the browser
back/forward cache reloads to check its session; pagehide removes private DOM.
Passwords are never written to storage, URLs, history, notices or logs. JavaScript
strings and in-flight browser requests cannot be securely erased from memory.
Only the existing theme choice is persisted.

Labels, current/new-password autocomplete, hidden username association, inline
alerts, error focus, a persistent status region and 48px form controls support
keyboard/password-manager use. No functional animation was added. See
[account verification](console-account-testing.md), [browser security](console-security.md),
[design](console-design.md), [console](web-console.md) and [feature connections](features.md).
Recovery/reset, MFA and real-device assistive-technology verification remain separate.

The same Account route now includes [session controls](console-session-controls.md).
Both forms share one pending account action, including login/logout exclusion and
password clearing when a session action starts.
