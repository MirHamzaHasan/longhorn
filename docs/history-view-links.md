# Saved command history views

Owner: examples/postgres/console/routes.ts and render in app.ts. Connects
[history filters](history-status-filters.md), [browser navigation](console-history-navigation.md),
[sign-in return](history-view-sign-in.md) and [verification](history-view-link-testing.md).

The command list takes its scope and delivery status from the URL fragment:

| Fragment | View |
| --- | --- |
| #/commands | Own commands, every delivery state |
| #/commands?state=failed | Own failed commands |
| #/commands?scope=all&state=pending | Explicit operator view of pending commands |
| #/commands?q=abcd1234 | Own commands whose ID begins with the entered prefix |

Supported query keys are scope (mine/all), state
(all/pending/running/succeeded/failed/unavailable) and optional [ID prefix q](console-history-search.md).
Defaults are mine/all with no search; canonical links omit defaults and use
scope-then-state-then-q order. Valid legacy
#commands and trailing-slash list links normalize with replaceState, preserving
the current browser-history entry. Empty fragments retain the original welcome/
default-list behavior. Existing UUID detail, reuse, delivery and audit routes work
without selector queries.

Unknown keys, duplicate decoded keys, invalid values, malformed paths and hashes
over 2,048 characters render an invalid-link state. Selectors are accepted only
on the command list. Owner, queue, cursor, page size and arbitrary return targets
are rejected; their values are never forwarded into a private list query. The
initial shell may still check the current session before interpreting a link.

A bookmark restores the first page of that selection. Loaded older pages, scroll,
pagination/export cursors, command numbers and owner/credential fields are not
encoded. Submitted ID prefixes are retained in the address/history/bookmarks.
The API keeps v1/v2 for unsearched views and uses [v3 for search](history-search-cursors.md). Each recipient reads under their own
fresh cookie/viewer and owner/operator policy. A member opening scope=all receives
the server's access denial and an explicit action to open their own matching view.
The application does not silently reinterpret the requested scope.

Fragments and browser navigation need no new HTTP endpoint, schema, grant or
dependency. Local/session storage still contains no private application state;
the browser's ordinary address/history/bookmark facilities retain the filter URL.
