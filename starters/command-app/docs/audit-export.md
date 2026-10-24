# Export recovery audit

Owner: console/audit-export.ts, bounded-export.ts and auditExportControls in app.ts.
Connects [recovery](recovery.md), [viewer admission](viewer-binding.md),
[command exports](history-export.md), [browser](console.md) and [backup](backup.md).

Numbers-operators can choose Export audit on the global or delivery-scoped Recovery
audit page. It starts at the oldest matching action independently of visible list
pages. Every request uses the existing fixed-queue operator API with current
session, role and displayed-viewer admission. Members remain denied. There is no
new endpoint, grant, schema, package dependency or mutation.

The UTF-8 NDJSON header is {type:longhorn-recovery-audit,version:1,exportedAt,
selection:{queue,deliveryId}}. queue is outbox.command.numbers.v1 and deliveryId is
null for all deliveries. Each type=audit line has record={id,queue,deliveryId,actor,
reason,createdAt,expectedMaxAttempts,additionalAttempts,availableAt,outcome,result}.
Actor is the API's public `user:<account ID>`; result is the recorded state/attempts/
maxAttempts/lastFailure, or null exactly for missing. Scheduled, conflict,
budget-exhausted and missing actions survive unchanged, including after delivery
pruning. Unknown/private response fields are omitted; invalid known fields fail.

The type=end trailer gives count, complete, reason and nextCursor. The shared
app-local collector limits each segment to 10,000 records, 100 sequential pages of
at most 100, 8 MiB and two minutes. Byte rejection keeps the previous accepted page
boundary. Continue export resumes it; Start over begins again. Each page is live,
so completion means cursor exhaustion and does not promise a database snapshot.

Cancel, navigation/scope changes, timeout or later auth/network failure discard the
current segment. Prior downloaded files remain independent. Preparation and its
continuation use only page memory; temporary Blob URLs are revoked. The browser
chooses the local save destination. Export ready confirms initiation, not disk save.
Files include private actor metadata but exclude command numbers, payloads, lease
tokens, passwords and session credentials/digests. They are separate from command
history v1/v2 and cannot restore a database or replace an offline checkpoint.
