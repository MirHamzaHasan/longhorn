# Browser command-ID search

Owner: console/history-search.ts, routes.ts, app.ts and app.css. Connects
[API](history-id-search.md), [saved views](history-view-links.md),
[searched export](history-search-export.md) and [verification](history-search-testing.md).

Commands adds Command ID starts with and Search. Paste a full UUID or at least
four characters from its beginning. Search trims/folds valid input and submits
explicitly; typing alone makes no request and does not change the applied view.
Invalid input stays beside the field with an alert, linked error and focus on
the input. Clear search removes only q, keeping scope and delivery status.

Scope/status changes retain the applied search. Show all clears only status;
an empty search result still leaves its search controls available. Load older
uses the captured prefix, state, scope and v3 cursor. A new submitted search
starts at the first page and disposes old reads/export work; late older pages
cannot replace or append to the new results.

Canonical saved links now include q after scope/state. Reload, Back/Forward,
detail return links and validated sign-in destinations retain that prefix. The
entered ID prefix is therefore visible in the address and ordinary browser
history/bookmarks. Owner/actor, payload, password and cursor fields remain excluded.
Each recipient still reads under their own current account permissions; a member
opening all scope gets actual denial and an explicit own-scope action retaining
both status and prefix.

Export uses the applied prefix rather than an unsubmitted input draft. Search
files identify the narrowed selection with a v2 header; unsearched files remain
v1. No private command data or continuation is added to browser storage.

The form reuses labelled native controls, existing contrast/focus tokens and button
targets. It wraps at phone width and 130% text in both themes. No live keystroke
search, animation or claimed total-count statistic is introduced. Physical
assistive technology and other browser engines retain their manual-check boundary.
