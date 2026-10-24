# Browser console

Owner: console/app.ts, app.css and src/console.ts. Fixed public assets use a strict
same-origin CSP with no inline/eval scripts. Private data arrives through guarded
relative API requests; text uses textContent. Only the theme is saved in browser
storage. Route changes cancel old reads; ordinary protected 401 clears private content and shows sign-in.
[Account settings](account.md) use a fresh session probe to distinguish a wrong
current password from expiry, and never replay an unconfirmed password change.

History, create/detail/receipt and operator delivery/audit screens use actual APIs.
Light/dark layouts adapt to narrow widths. Labels, keyboard focus, skip navigation,
larger text and automated accessibility checks were verified in Chromium. Real-device
assistive technology and other browser engines remain manual verification.
Connects [accounts](accounts.md), [commands](commands.md) and [recovery](recovery.md).

[Run again](command-rerun.md) reviews saved numbers before a separate submission.
[Viewer consistency](viewer-binding.md) prevents old views from reading/submitting
under another tab's switched cookie, without clearing the valid other session.

[Delivery status](history-filters.md) filters Commands within the current scope.
Selection starts a fresh page; Show all retains scope. Older-page cancellation
cannot replace or announce errors on the new selection. Controls stack on phones
and selection resets on a full reload.
