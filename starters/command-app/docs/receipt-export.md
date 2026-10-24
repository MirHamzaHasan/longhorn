# Export computed receipts

Owner: console/receipt-export.ts, history-metadata.ts, bounded-export.ts and app.ts.
Connects [receipt storage](receipts.md), [history](history.md), [viewer admission](viewer-binding.md),
[command metadata files](history-export.md) and [backup](backup.md).

In Commands, choose Computed receipts under Export contents, then Export receipts.
The file uses the selected owner/operator scope, delivery status and ID search.
Command detail also exports that exact command after fresh protected reads. Each
request retains current cookie/viewer and owner/operator policy. Exporting does
not create, dispatch or recover commands, and adds no schema, grant or endpoint.

The UTF-8 NDJSON header has type=longhorn-command-receipts, version=1, exportedAt
and selection. History selection is {kind:history,scope,state,q}, with q null or a
normalized prefix; direct selection is {kind:command,commandId}. Each
type=command-receipt line contains safe command/delivery metadata and receipt.
receipt is {status:not-found} for an actual protected 404 or {status:received,
receipts:[{messageId,result:{count,sum,min,max}}]}. There are at most 100 results
per command. Raw numbers, payloads, lease tokens and credentials are excluded;
computed aggregates are private command data. not-found does not assert pending
delivery or permanent absence. Other failures discard the whole current segment.

The type=end trailer gives this file's command count, complete, reason and
nextCursor. Segments allow 1,000 commands, ten serial history pages of at most 100,
8 MiB and two minutes. Receipt reads are serial under the same budget/signal.
Whole-page byte rejection keeps the last accepted history cursor. Continue export
uses it; Start over begins again. Single-command files contain exactly one row.
Metadata and receipt observations are live reads, not a shared snapshot.

Cancel, navigation, changed export contents or filters, timeout and later auth/
network errors initiate no file from that attempt. Page-owned follow updates and
export both stop on leaving detail. Continuations stay in page memory and Blob
URLs are revoked. Changing contents resets the continuation; a new view defaults
to Command history. Export ready means download initiation, with the browser
choosing the save location. Files cannot restore state or replace an offline backup.
