# Command history ordering and cursor scope

Owner: command-history.ts. Connects [history HTTP](account-command-history.md),
[schema positions](command-history-migrations.md) and [native concurrency proof](command-history-testing.md).

History orders by history_id DESC and seeks history_id < the previous page's last
position. LIMIT+1 determines whether another page exists. The unique global and
owner/history indexes support that ordering; no OFFSET or timestamp equality is
needed. Positions use decimal int64 strings in cursors, never JavaScript numbers.
Native tests pass values above Number.MAX_SAFE_INTEGER without rounding.

The base64url JSON cursor contains version, authenticated viewer ID, mine/all
scope, fixed outgoing queue and before position. Decoding checks all fields,
positive int64 range, strict object shape and expected context. A different
account or scope cannot reuse it. Page size can change. Invalid/malformed/oversize
cursors return 400; unsupported global scope is denied before querying.

Cursors are encodings, not signatures or secrets. A caller can choose a different
position by editing an otherwise valid cursor, but the database's principal-derived
owner predicate and the current operator role gate still decide access. No cursor
field supplies another owner's filter or grants global authority. Cursor values
are not stored sessions and do not preserve a revoked role.

[Delivery filters](history-filter-cursors.md) preserve this v1 format for omitted/
all state. Filtered v2 cursors additionally bind the selected status; changing a
filter requires a fresh page. Status membership is live across continuations.

Each page sees current committed rows and delivery metadata. A newer insertion
has a higher position and appears on a fresh first page, keeping continued older
pages from repeating it. Identity allocation precedes transaction commit: a
lower-position writer can commit later and become visible on a later page. If
the cursor already passed that position, refresh from the first page to see it.
There is no held snapshot, total-count guarantee or commit-order claim. Deletion
can likewise remove a row between pages without resurrecting it.

The native gate checks concurrent producers, new inserts during traversal, a
lower-position late commit, exact large positions, changed users/scopes and actual
application restart with a saved cursor. Read-only pagination does not take
authorization row locks across requests or keep database transactions open.
