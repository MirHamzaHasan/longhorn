# Command history export

Owner: examples/postgres/console/history-export.ts and historyExportControls in
app.ts. Connects [history HTTP](account-command-history.md), [format](history-export-format.md),
[lifetime and authorization](history-export-lifecycle.md), [controls](console-history-export.md)
and [native verification](history-export-testing.md).

Export history downloads the complete selected history across API pages, split
into explicit continuation files when a segment reaches its bound. It starts from
the newest matching command, independently of which rows are currently loaded in
the list. Scope and delivery state are copied from the current selectors. Members
export their own commands; current operators can explicitly select deployment-wide
history. An empty admitted selection produces a valid zero-command file.

Files contain command IDs, creation times, retained delivery IDs and current safe
delivery summaries. They contain no numbers, payloads, lease tokens, credentials,
usernames, owner IDs, receipts or audit records. This is a metadata export, not a
database/receiver backup or an import/restore format. Use [offline backup](command-app-backup.md)
to preserve actual application state.

A segment reads sequential pages of at most 100 commands, with at most 10,000
commands, 100 pages, 8 MiB of UTF-8 output and two minutes per attempt. Existing
15-second request deadlines still apply. The byte budget reserves 4 KiB for its
summary; if a page would exceed it, the entire page is excluded and the previous
cursor is retained. No rows from that rejected page are skipped. An oversized first
page fails without producing a file. Final output size is checked again.

The summary states complete or provides a reason and nextCursor. Continue export
uses that exact cursor to download the next segment; it never silently labels a
bounded segment as the entire history. Start over or reloading/navigation begins
again at the newest matching command. Continuation is held only in page memory.

Each page is a fresh live read. Concurrent delivery changes, pruning, deletion
and late commits retain the [existing cursor limitations](command-history-cursors.md).
The export is neither a held snapshot nor a total-count guarantee. Failure or
cancellation discards the entire current segment; previously saved files remain
independent. No endpoint, schema, grant, dependency or mutation is added.
