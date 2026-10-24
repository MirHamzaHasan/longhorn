# Command-ID prefix search

Owner: PostgresCommandHistory and commandHistoryQuery in examples/postgres/src.
Connects [history HTTP](account-command-history.md), [search cursors](history-search-cursors.md),
[index deployment](history-search-migrations.md), [console](console-history-search.md),
[searched files](history-search-export.md) and [proof](history-search-testing.md).

GET /account/commands accepts optional q: a prefix from the start of a command's
UUID. The normalized prefix is 4–36 characters, with hexadecimal characters and
hyphens only at UUID separator positions. Up to 128 raw characters are accepted
before trimming surrounding whitespace and folding ASCII case. Blank input is
the unsearched view. Wildcards, substrings, request keys, numbers and payload
search are not supported. Existing commands and their original ID casing remain
unchanged; SQL compares pg_catalog.lower(c.id) with a bound prefix plus %.

Search composes with the existing mine/all scope, delivery state, 1–100 limit and
history-position pagination. Owner identity still comes from the authenticated
principal, and explicit all scope still requires current numbers-operator access.
Unknown/duplicate claims fail under the existing route policy. The search term
cannot select an owner, queue or role. Anonymous and forbidden requests retain
their 401/403 outcomes before any admitted list read.

The same metadata-only projection is returned: IDs, time, retained delivery ID and
current delivery summary. Search reads no numbers, payload or lease token. Missing
or pruned metadata remains unavailable, and a job in another queue cannot attach.
Sorting remains newest insertion position first; identity positions stay decimal
int64 strings. Status changes and late commits retain the existing live-list limits.

The prefix is deliberately constrained before constructing a SQL parameter, so
caller-supplied LIKE wildcard/escape characters never enter the predicate. Two
owner-deployed expression indexes support prefix access. Returned rows are bounded;
matching/scanning/sorting work still depends on data distribution and the planner.
Deploy the complete appended migration profile before updated HTTP hosts.
