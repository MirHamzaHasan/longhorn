# Delivery-filter cursor context

Owner: commandHistoryPosition and PostgresCommandHistory.list in command-history.ts.
Connects [existing pagination](command-history-cursors.md), [filter API](history-status-filters.md)
and [verification](history-filter-testing.md).

Unfiltered requests, including explicit state=all, continue to emit and accept
the original strict v1 cursor. Existing unfiltered bookmarks remain usable.
Status-only requests emit strict v2 cursors containing the selected status alongside
viewer, scope, fixed queue and decimal before position. A v1 cursor cannot enter
a filtered query; a v2 cursor cannot enter another filter or an unfiltered query.
Changing viewer, scope, queue, version or shape also fails with 400. Page size may
change. Positive int64 positions remain strings, including above JavaScript's
safe integer range. Length, base64url and fatal UTF-8 checks precede JSON parsing.

The repository copies scope, limit, after and selected state before awaiting SQL.
Mutating the caller's object while a query runs cannot change page slicing or the
context encoded into its continuation. SQL predicates and continuation context
come from the same copied values.

Cursors are unsigned encodings, not credentials. A caller can rewrite a complete
valid encoding; authenticated owner predicates and fresh operator admission still
control access. A saved cursor grants neither another account's rows nor a
revoked role. Restart does not invalidate a well-formed cursor when its context
and schema remain supported.

Status membership is evaluated afresh for each page. A command that changes state
above an already-consumed boundary will require refresh to appear in that filter.
Lower-position late commits, deletion and pruning retain the existing live-list
limitations. No transaction or snapshot is held between requests.

[ID search](history-search-cursors.md) uses strict v3 with both state and canonical q.
Unsearched v1/v2 continuations remain unchanged.
