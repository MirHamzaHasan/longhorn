# Command history delivery filters

Owner: examples/postgres/src/command-history.ts and the account operations router.
Connects [history HTTP](account-command-history.md), [cursor context](history-filter-cursors.md),
[indexes and deployment](history-filter-migrations.md), [browser controls](console-history-filters.md)
and [native proof](history-filter-testing.md).

GET /account/commands accepts one optional state parameter:

| state | Membership at the time of the query |
| --- | --- |
| all, or omitted | Every admitted command |
| pending | Matching outgoing job is pending |
| running | Matching outgoing job is running |
| succeeded | Matching outgoing job has succeeded |
| failed | Matching outgoing job has failed |
| unavailable | No matching job metadata in the fixed command queue |

The browser labels running as Sending and succeeded as Delivered. These describe
outgoing delivery; the protected receipt endpoint remains the source of computed
results. Unavailable includes legacy commands with no association and commands
whose metadata was pruned. A retained delivery ID or an unrelated queue's job
does not supply a status. Missing metadata never implies failure or success.

Filtering applies to the existing principal-derived mine scope. Explicit all
scope still requires the current numbers-operator role; selecting a status grants
no additional authority. Authentication, viewer consistency and scope admission
precede the read. Unknown or duplicate query parameters return 400; anonymous
and forbidden scope requests retain their existing 401/403 behavior.

One parameterized SQL query selects only identity, time and delivery summary,
orders by exact history position and requests limit+1 matching rows. It reads no
numbers, payload or lease token. Responses keep the same commands/nextCursor
shape, no-store policy and 1–100 page limit. The query bounds returned rows, not
the amount of database work: common states and unavailable anti-joins can visit
many rows. The [index guide](history-filter-migrations.md) records measured scope.

Membership is live. Dispatch, retry and pruning can move a command between
filters between requests. Refresh starts at the newest matching position; there
is no snapshot, total count or cross-page completeness claim. The console now owns
[bounded list polling](command-history-updates.md) above this unchanged API.
