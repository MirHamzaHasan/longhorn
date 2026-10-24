# Search-bound v3 history cursors

Owner: commandHistoryPosition and PostgresCommandHistory.list. Connects
[v1 pagination](command-history-cursors.md), [v2 status context](history-filter-cursors.md),
[search API](history-id-search.md) and [native proof](history-search-testing.md).

Unsearched all-state pages keep v1 cursors. Unsearched status-filtered pages keep
v2. A nonempty normalized search emits strict v3 containing viewer, scope, fixed
queue, decimal before position, selected state (including all) and canonical q.
Changing or removing q, changing state/scope/viewer/queue, or entering search with
an old v1/v2 cursor fails with 400 before SQL. Page size may still change.

Whitespace/case normalization happens on the query, so an uppercase spelling of
the same prefix can continue its canonical v3 page. Encoded cursor q itself must
already be canonical. Blank query input is unsearched and cannot continue a v3
cursor. UTF-8/base64url, shape, size and positive int64 checks remain in force.

The repository copies q with scope/state/limit/after before awaiting the database.
The predicate, slicing and continuation therefore share the same copied context
even if a trusted caller mutates its input object during the read. Native tests
continue search positions above Number.MAX_SAFE_INTEGER after a real app restart.

Cursors remain unsigned position encodings. A caller may rewrite a complete
encoding, but principal-derived predicates and fresh operator admission still
govern every request. A cursor grants no access and preserves no revoked role.
Search is live across pages, with the same deletion, pruning and late-commit
limitations as ordinary history; no snapshot or total-count promise is added.
