# Recovery audit NDJSON v1

Owner: collectAuditExport in console/audit-export.ts. Connects [feature](recovery-audit-export.md),
[bounds](bounded-page-export.md) and [audit storage](outbox-audit-storage.md).

Each UTF-8 .ndjson file has one JSON object per line and ends in a newline:

| Line | Fields |
| --- | --- |
| Header | type=longhorn-recovery-audit, version=1, exportedAt (UTC ISO), selection={queue,deliveryId} |
| Each action | type=audit, record={id,queue,deliveryId,actor,reason,createdAt,expectedMaxAttempts,additionalAttempts,availableAt,outcome,result} |
| Trailer | type=end, count, complete, reason, nextCursor |

queue is outbox.command.numbers.v1. selection.deliveryId is null for all deliveries
or the selected delivery UUID. exportedAt is preparation start, not snapshot time.
Times are nonnegative safe integer epoch milliseconds. Audit/delivery IDs must be
UUIDs. Actor is bounded nonempty text. Reason is manual-retry, provider-restored,
configuration-fixed or investigating. Requested allowances are integers in 1..100.

outcome is scheduled, conflict, budget-exhausted or missing. result is null exactly
for missing; otherwise it is {state,attempts,maxAttempts,lastFailure}. State uses
pending/running/succeeded/failed, attempts is a nonnegative safe integer, allowance
is in 1..100, and lastFailure is null or handler/invalid-payload/lease-expired.
These are the recorded retry-time observations, not current queue state.

The projector copies only named fields and requires every record to match the fixed
queue and selected delivery. Unknown response fields are omitted; invalid known
fields fail the whole segment. JSON encoding escapes line breaks. The common
collector rejects malformed pages, repeated cursors and duplicate audit IDs.

complete=true means reason=complete and nextCursor=null. Otherwise reason is
row-limit, page-limit or byte-limit, and nextCursor is the last accepted page's
position. Resume with the same delivery selection and current authorized operator
through the existing audit API. The cursor is an unsigned position, never a grant.
The continuation is not restored from a downloaded file by the console.

The filename is `longhorn-audit-all-<timestamp>.ndjson` or uses the selected UUID in
place of all. It contains no actor/reason text. The Blob MIME is
application/x-ndjson;charset=utf-8. Incompatible schema changes require a new version;
command history v1/v2 are separate file types and remain unchanged.
