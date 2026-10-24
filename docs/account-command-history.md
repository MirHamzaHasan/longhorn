# Account command history API

Owner: PostgresCommandHistory and the account operations router in examples/postgres.
Connects [accounts](account-operations.md), [history migration](command-history-migrations.md),
[cursor behavior](command-history-cursors.md), [delivery projection](command-history-delivery.md)
and [native verification](command-history-testing.md).

GET /account/commands returns {commands, nextCursor}. Each command contains id,
createdAt, deliveryId and current delivery metadata. The list excludes command
numbers, outgoing payloads and lease tokens. Existing GET /account/commands/:id
and its protected receipt route supply the detail after ownership checks.

| Query | Behavior |
| --- | --- |
| scope=mine | Default; current authenticated user's commands, including for operators |
| scope=all | Explicit numbers-operator view across this deployment's command queue |
| limit | Default 20, range 1–100 |
| after | Opaque nextCursor from the previous page |

Cookie/session authentication runs first. Anonymous requests get 401. Members
requesting the all scope get 403, including duplicate scope parameters. The
validated scope is checked again before querying. Duplicate parameters and
unknown owner/queue/state claims are rejected; an owner filter never derives from HTTP claims.
Responses retain no-store and Vary: Cookie. Roles are fresh admission snapshots;
ordinary reads are not retroactively cancelled after concurrent revocation.

The repository resolves through DI against the same database as the command
writer. New command/outgoing writes retain one managed transaction: authenticate,
stage the validated outgoing record, then insert the business row with its
delivery ID/time. An insertion failure rolls the staged record back. Request
idempotency still returns its original saved response without another command.
History reads live status separately from that original delivery snapshot.

Pagination is latest insertion-position first, with a unique database int64 key.
An explicit cursor carries viewer/scope/queue/version context. It is not an
authorization credential. Newer inserts appear on a fresh first page; continued
pages walk older positions. This is a live listing rather than a held snapshot.
The [cursor guide](command-history-cursors.md) details late commits and refresh.

The normal PostgreSQL executable stays independent; this route is available when
account operations are enabled, including the temporary demo and persistent host.
Apply the complete operations migration profile before starting the updated host.

The console can [reuse an admitted source](command-rerun.md) through its existing
detail GET and ordinary new submission. The source remains unchanged and supplies
no target owner or lineage metadata. [Viewer consistency](console-viewer-binding.md)
is an optional pre-handler claim check; owner predicates still use the cookie principal.
