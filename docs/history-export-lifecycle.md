# Export admission and page lifetime

Owner: the console export collector, API helper and clearPageWork. Connects
[export behavior](history-export.md), [viewer binding](console-viewer-binding.md),
[browser boundary](console-security.md) and [native proof](history-export-testing.md).

Each page uses the existing same-origin, no-store cookie GET with the displayed
public viewer ID. The server independently reauthenticates the cookie and applies
the owner predicate or explicit current operator gate. A cursor grants no authority.
Changing cookies, revoking a session or withdrawing an operator role is observed
on the next page admission. Already admitted reads keep their ordinary timing;
this does not promise push revocation of data already read or previously saved.

One export attempt per page owns a cancellation signal and a fixed deadline. Its
collector awaits one page before requesting another. Cancellation aborts the HTTP
request and is checked again after settlement, before serializing a segment and
before triggering the download. Late ignored responses cannot produce a file.
Network/schema/auth failures discard all collected rows from that attempt rather
than saving a misleading partial success or automatically replaying a request.

Navigation, pagehide, filter changes and scope changes abort the task through the
same page ownership hook used by [command following](command-follow-lifecycle.md).
The final UI check binds version, hash route and displayed subject. Error notices
and downloads from an old page cannot enter a newer page. API 401 handling still
clears private UI; viewer mismatches preserve the valid other-account cookie.

Collected text and continuation cursors stay in memory; neither browser storage
nor the URL receives them. The temporary Blob URL is revoked after download
initiation or immediately on page cleanup. Timer/listener cleanup happens on all
collector outcomes. Browser save/cancel behavior remains browser-owned: Export
ready means preparation finished and a download was initiated, not that a file was
confirmed on disk. Explicitly saved files persist independently of the application.
