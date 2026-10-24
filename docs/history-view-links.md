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

The only supported query keys are scope (mine/all) and state
(all/pending/running/succeeded/failed/unavailable). Defaults are mine and all;
canonical links omit them and use fixed scope-then-state order. Valid legacy
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
pagination/export cursors, command numbers and user IDs are not encoded. The API's
existing v1/v2 cursor protocol is unchanged. Each recipient reads under their own
fresh cookie/viewer and owner/operator policy. A member opening scope=all receives
the server's access denial and an explicit action to open their own matching view.
The application does not silently reinterpret the requested scope.

Fragments and browser navigation need no new HTTP endpoint, schema, grant or
dependency. Local/session storage still contains no private application state;
the browser's ordinary address/history/bookmark facilities retain the filter URL.
