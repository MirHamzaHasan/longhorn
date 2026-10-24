# Browser history export controls

Owner: historyExportControls and shared fileExportControls in console/app.ts,
plus the history-export CSS. The same control owns [audit downloads](console-audit-export.md). Connects
[format](history-export-format.md), [lifetime](history-export-lifecycle.md),
[history filters](console-history-filters.md) and [proof](history-export-testing.md).

Commands defaults to Command history in the labelled Export contents selector.
[Computed receipts](console-receipt-export.md) is a separate choice under the same
view. Switching contents cancels the old attempt and clears its continuation.

Commands shows Export history beneath the current scope/status selectors, including
empty selections. The hint names the exported fields. Export starts from the newest
matching command even if Load older has expanded the visible list. Preparation
reports accepted command counts; no fabricated percentage or total is shown.

Cancel export aborts the current attempt and saves no file. On success, a local
download starts and the status says Export ready with this file's command count.
A bounded segment offers Continue export and Start over. Continue keeps the same
viewer/scope/status and last accepted cursor; Start over resets that pointer.
Selection changes/navigation cancel preparation and create a fresh export control.
Errors retain the previous successful continuation so an explicit retry starts
from the same unsaved segment boundary.

Buttons stay in the existing kit and preserve focus. Busy/finished controls use
aria-disabled plus guarded handlers; a focused Cancel control remains in the DOM
after preparation finishes. Start over deliberately returns focus to Export history.
A polite atomic local status region reports preparation, cancellation and results,
with count updates limited to the first page and every tenth page. Controls wrap
at phone widths and support 130% text in both themes without animation.

The browser decides whether and where to save. Downloads contain private account
metadata under the user's chosen selection; no file is sent to another service.
The format and continuation bounds are described in the separate feature guides.

[Saved list URLs](history-view-links.md) restore only scope/status. Reloading or
revisiting that view creates a new export control without an old continuation;
actual export still starts at the selected newest page unless Continue export is
explicitly available in the current control.
