# History export NDJSON v1

Owner: collectHistoryExport in console/history-export.ts. Connects [feature](history-export.md),
[cursor rules](history-filter-cursors.md) and [verification](history-export-testing.md).

Each UTF-8 .ndjson file contains one JSON object per line and ends with a newline:

| Line | Fields |
| --- | --- |
| Header | type=longhorn-command-history, version=1, exportedAt (UTC ISO string), selection={scope,state} |
| Each command | type=command, command={id,createdAt,deliveryId,delivery} |
| Final summary | type=end, count, complete, reason, nextCursor |

exportedAt marks this segment’s preparation start, not a database snapshot time.
createdAt is epoch milliseconds or null. deliveryId is retained identity or null.
delivery is either null or the established id/state/attempts/maxAttempts/availableAt/
updatedAt/lastFailure metadata projection. Missing metadata remains unavailable;
it is not converted to success or failure. A receipt is a separate protected fact.
State values use the API names, including running and succeeded rather than the
browser's Sending and Delivered labels.

The summary count describes only this file. complete=true requires nextCursor=null
and reason=complete. Otherwise reason is row-limit, page-limit or byte-limit and
nextCursor is the last accepted page's cursor. Pass it unchanged with the same
authenticated viewer/scope/state to continue through the existing history API.
It remains an unsigned position encoding, never an authorization credential.

The browser copies only named fields, validates nullable summaries, bounded strings,
safe integers, queue states, delivery association, page size and cursors, and rejects
duplicate commands or repeated cursors. Unexpected fields are omitted, including
any numbers/payload accidentally added by a future API response. JSON encoding
escapes embedded line breaks; Unicode is counted as UTF-8 bytes for the file limit.

The filename uses only fixed scope/state names and a generated timestamp. The Blob
uses application/x-ndjson;charset=utf-8 and is downloaded locally through a temporary
object URL. No import endpoint or round-trip compatibility with a database dump is
implied. Future incompatible format changes require a new version.
