# Browser account settings

Owner: console/app.ts, app.css and src/console.ts. Open Account after signing in
as either a member or operator. Enter the current password, a different replacement
and confirmation. New input uses 15–128 Unicode code points and preserves spaces.
The form calls the existing [password API](password-changes.md) using the normal
HttpOnly cookie and exact Origin. There is no second identity store.

The host advertises a public boolean password capability. The operator host enables
it after readiness verifies the owner-deployed functions and explicit runtime grants.
An unconfigured custom host shows no password form; browser visibility grants no API
permission. See [schema](schema.md) and [accounts](accounts.md).

Success ends all prior subject sessions and shows sign-in with the new password.
A wrong current password retains the account only after a fresh same-subject
session check; an expired/unverifiable session clears private UI. Throttling shows
the server wait time. Password fields clear immediately on submission and again
on outcome/navigation/pagehide. Only the theme is stored; passwords never enter
URLs, notices or browser storage. JavaScript strings/in-flight requests cannot be
securely erased from memory.

Only one password change can be pending. Reentered forms, sign-in/registration and
Sign out stay disabled until it settles. A late success still requires sign-in; a
late rejection cannot restore a departed form. A lost response, unexpected result
or 15-second deadline is unconfirmed: try signing in with the new password, then
the previous one if necessary. There is no automatic replay. Browser abort cannot
undo native work already accepted; clearing local UI alone does not revoke a valid
server session. pagehide removes private DOM and a restored page reloads its session.

Labels, autocomplete, keyboard/error focus, 48px controls, both themes and narrow
widths follow the [console](console.md). Repository verification uses real native
PostgreSQL/scrypt and Chromium, plus 42 accessible screenshots. The independent
archive gate uses this shipped form after actual restore/regrant and checks old
sessions, peer preservation, retained history and restart. Physical-device
assistive technology, other browser engines and password-manager apps require
manual checks. Recovery/reset and MFA are separate features.

Connects [features](features.md), [backup](backup.md) and [deployment](deployment.md).
