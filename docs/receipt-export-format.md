# Command receipt NDJSON v1

Owner: collectReceiptExport in console/receipt-export.ts. Connects [feature](receipt-export.md),
[shared metadata](command-metadata-projection.md) and [limits](receipt-export-lifecycle.md).

Every UTF-8 .ndjson file has one JSON object per line and a final newline:

| Line | Fields |
| --- | --- |
| Header | type=longhorn-command-receipts, version=1, exportedAt (UTC ISO), selection |
| Each command | type=command-receipt, command={id,createdAt,deliveryId,delivery}, receipt |
| Trailer | type=end, count, complete, reason, nextCursor |

History selection is {kind:history,scope,state,q}, with q null or a normalized UUID
prefix. Single-command selection is {kind:command,commandId}. exportedAt records
preparation start, not snapshot time. command uses the existing closed metadata
projection, including nullable retained delivery identity/current summary. Exported
command IDs and receipt message IDs must be UUIDs.

receipt is {status:not-found} for an actual protected 404, or
{status:received,receipts:[{messageId,result:{count,sum,min,max}}]}. A received page
has 1..100 entries with unique UUID message IDs. Count is an integer in 1..100;
sum/min/max must be finite numbers. The collector copies only named fields and
omits arbitrary response additions. Empty successful pages, duplicate message IDs,
invalid fields and excessive pages fail the current file rather than becoming
not-found observations. A recorded message ID can differ from the command ID.

The trailer count is commands, including not-found rows, rather than the number
of receipt entries. complete=true requires reason=complete and nextCursor=null.
Otherwise reason is row-limit, page-limit or byte-limit and nextCursor is the last
accepted history page's cursor. Continue with the same scope/state/q and current
authenticated viewer. A single-command file has exactly one row and no continuation.
No total receipt count or cross-read snapshot guarantee is encoded.

The filename starts longhorn-receipts-, followed by fixed scope/state names or the
selected command UUID and a generated timestamp. It excludes the search term,
user identity and raw values. MIME is application/x-ndjson;charset=utf-8. JSON
encoding escapes line breaks and byte accounting uses UTF-8. This v1 type is
separate from command-history v1/v2 and audit v1; consumers must recognize the type
and version. Incompatible future changes require a new version.
