# Command list update controls

See the [development handoff](development-handoff.md) for the last verification.

Owners: [history-list.ts](../examples/postgres/console/history-list.ts) and the
existing [console kit](web-console.md). Connects [API behavior](command-history-updates.md),
[lifetime](history-update-lifecycle.md), [filters](console-history-filters.md),
[search](console-history-search.md), [named views](console-saved-views.md) and [QA](history-update-testing.md).

Commands displays a status and Pause list updates below the existing search/export
controls. Resume list updates, Try list updates and Check list again each describe
the next action. Temporary hidden/offline pauses explain why no requests run. Deep
manual browsing offers Refresh list and retains all loaded commands until that
explicit action. Empty views keep their create/filter action and can gain real rows.

Only changed metadata cells update. Surviving rows and links keep their identity;
insertion/reordering preserves the visible row anchor and keyboard focus. If a
focused command leaves the filter/window, focus moves to the update control and
the status explains it. A focused final Load older control also returns there.
Unchanged empty states retain their focused action. Forms, saved-view editing,
exports and selected filter controls are not rebuilt by a cycle.

Status uses a polite, atomic live region and announces changed results rather than
every unchanged read. Manual paging retains the existing loaded-count notice.
Controls use native buttons, a 44px minimum height, keyboard focus styles and the
existing light/dark tokens. The layout wraps at phone widths and 130% text; delivery
state has words as well as color. No animation or reduced-motion override is added.

Actual Chromium/AXE captures cover empty, paused, delivered, paged, emptied filter,
permission failure and deep-history states in both themes/widths plus enlarged
text. Physical VoiceOver/TalkBack, other browser engines and device tap dimensions
remain manual verification boundaries.
