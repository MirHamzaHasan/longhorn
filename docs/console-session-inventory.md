# Account active-session controls

Owner: [session-inventory.ts](../examples/postgres/console/session-inventory.ts),
composed by the existing Account page. Connects [HTTP](session-inventory-http.md),
[page/viewer ownership](console-viewer-binding.md), [lifecycle](session-inventory-lifecycle.md)
and [native browser proof](session-inventory-testing.md).

The panel lists ten live sessions per request, shows expiry and “This session”,
and supports explicit refresh/load-more. Numbered rows are display positions, not
device identities. Dates come from actual session records. There is no inferred
creation time, browser/IP fingerprint, fake location or background tracking.

End session opens a row-local confirmation with Cancel focused. Cancel returns
focus to the original control. Confirmation captures the immutable public reference,
clears visible rows and passwords, excludes concurrent account changes and sends
one mutation. Successful other-session removal fetches a fresh page and returns
focus to Refresh sessions. Current removal clears the cookie and opens an enabled
sign-in form. Existing others/all controls refresh this inventory when they finish.

A committed reply lost in transport leads to fresh sign-in, without automatic retry
or a false failure/rollback claim. The expected viewer header refuses a stale
cookie-switched account. Navigation fences late reads and disposes row/cursor/event
state; mutation ownership continues to settlement. Failed/malformed reads clear
old rows and offer explicit refresh, including after a cursor/session change.

The panel reuses existing light/dark tokens and native controls, with text signals,
44px targets, named actions, stable focus and no new animation. Real screenshots
were inspected at desktop/phone widths and 130% text. Thirty captures cover loaded,
continued, confirmation, loading, permission failure, uncertain mutation and changed
viewer states with no automated accessibility violations. Reduced-motion context
is verified; physical-device VoiceOver/TalkBack, real touch sizes and frame-rate
claims remain manual boundaries. See [verification](session-inventory-testing.md).
