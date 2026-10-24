# Bookmark command history views

Owner: console/routes.ts and app.ts. Connects [history](history.md),
[filters](history-filters.md), [export](history-export.md), [accounts](accounts.md)
and [console](console.md).

The list URL carries only scope=mine/all and state=all/pending/running/succeeded/
failed/unavailable. Examples: #/commands, #/commands?state=failed and
#/commands?scope=all&state=pending. Defaults are omitted and order is canonical.
Legacy short/trailing-slash list links remain usable. Unknown/duplicate query
keys, malformed paths and oversized fragments show an invalid-link state; owner,
queue, cursor and arbitrary return targets are never forwarded.

Selection changes create browser-history entries. Reload, Back/Forward and Refresh
read the first selected page with current permissions. Commands and detail return
links retain the latest view within this document; a directly reloaded detail URL
has no parent filter encoded. Loaded older pages, scroll and export continuation
remain in memory and reset when the route is re-created.

Signed-out saved views open Sign in and return to the validated selection after
login or registration. Reactive expiry keeps that selection in memory across
sign-in. Explicit logout clears it. Each account reads under its own cookie/viewer
and owner/operator policy. A member opening all scope receives denial and an
explicit own-scope action with the same status. No permission comes from the URL.

Existing page cleanup cancels reads/export/follow work and fences late results.
The browser stores no additional local/session data, and no HTTP endpoint, schema,
grant or dependency is added. Normal browser history/bookmarks retain the filter
fragment; actual command/private data is not encoded in the link.
