# Account-owned saved history views

Owner: examples/postgres/src/history-views.ts, history-views-http.ts and the
[console panel](console-saved-views.md). Connects [values](saved-view-values.md),
[schema](saved-view-migrations.md), [HTTP](saved-view-http.md), [write ownership](saved-view-concurrency.md)
and [native verification](saved-view-testing.md).

Members can name and save the current command scope, delivery status and ID search,
then reopen it in another session or after a host restart. Up to 20 active views
belong to each account. Names are private preferences, with exact case-sensitive
uniqueness after trimming/NFC normalization. Different names may hold the same
filters. A view stores no loaded commands, results, cursor, scroll position or
export continuation.

Create, rename/filter update, open and delete use the existing account middleware,
DI database, managed transactions and Idempotency service. Resource IDs are UUIDs
scoped to the authenticated account. All SQL predicates include that account;
even an operator cannot read or change another account's saved preferences.
Public records omit owner identifiers and credentials.

Operators may save an All commands selection. A former operator can still list
or delete that personal preference, or deliberately change it to My commands.
Reopening it uses current history admission and can be denied. Saved settings are
never an authorization grant, and a bookmark does not preserve old access.

Writes use revisions to prevent stale overwrites/deletes and stable request keys
to recover a lost acknowledgement. The quota has its own transaction advisory
lock; authentication's shared lock alone does not serialize two creates. No
command, message, receipt or recovery action is created by saving a view.

Active records persist until deliberately deleted; password/session changes do
not delete preferences. Deleted records leave the active collection. Committed
request replies replay for the existing 24-hour window. Expired rows can remain
until explicit idempotency pruning or key reuse; offline backups retain their
checkpoint state. No expiry, sharing, team-wide view registry,
public short link or import protocol is added. [Canonical filter URLs](history-view-links.md)
remain independent and continue working when a saved preference is deleted.
