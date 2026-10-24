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

[Command updates](command-updates.md) follow unfinished delivery/receipt detail
with a bounded read loop. Pause/resume and manual refresh remain available; hidden/
offline tabs pause and navigation disposes the loop without moving keyboard focus.

[History export](history-export.md) downloads the current selection as metadata-only
NDJSON with explicit continuation files. Cancel/navigation/filter changes stop the
current attempt; neither export data nor cursors enter persistent browser storage.

[Saved views](history-view-links.md) retain scope/status in canonical fragments.
Reload and Back/Forward re-read the selected first page; cold/expired sign-in
returns to the validated selection. Private data and cursors stay out of the link.

[ID search](history-search.md) submits a normalized UUID prefix, retains it across
status/scope changes and saved-view navigation, and uses inline validation.
Clear search preserves the other filters; searched export uses an explicit v2 header.

Commands offers [computed receipt downloads](receipt-export.md) under Export
contents. Detail exports exactly that command after fresh protected reads; follow
and download work both stop when leaving the page.
