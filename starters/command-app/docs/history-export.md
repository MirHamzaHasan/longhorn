# Export command history

Owner: console/history-export.ts and historyExportControls in console/app.ts.
Connects [history](history.md), [filters](history-filters.md), [console](console.md),
[viewer admission](viewer-binding.md) and [backup](backup.md).

Export history reads every selected history page, beginning with the newest match.
Members export their own rows; current operators must explicitly select All commands
for deployment-wide metadata. Each page retains real cookie/viewer and owner/role
checks. This feature adds no endpoint, schema, grant or automatic mutation.

The UTF-8 .ndjson file starts with a version=1 longhorn-command-history header and
selection/time, then one type=command metadata object per line, then a type=end
summary with this file's count, complete, reason and nextCursor. Fields include IDs,
times and safe delivery summaries; numbers, payloads, lease tokens, credentials,
receipts and audit are excluded. Missing metadata remains null. This is not a
backup or restore/import format.

Each segment allows 10,000 commands, 100 sequential pages of at most 100, 8 MiB and
two minutes. The byte bound reserves summary space and rejects a whole page so
continuation skips no accepted rows. Continue export uses the exact returned cursor;
Start over begins again. Complete means cursor exhaustion, not a held snapshot.
Live status changes, pruning and late commits keep the existing pagination limits.

Cancel, navigation, filter/scope changes, timeout or errors discard the current
segment without a download. Earlier saved files remain independent. Preparation
uses memory only, and temporary Blob URLs are revoked. A browser may still ask
where to save; Export ready confirms preparation/download initiation, not disk
completion. No export data or continuation is stored in browser storage or URLs.

[ID search](history-search.md) uses version=2 and selection={scope,state,q}; ordinary
unsearched files remain v1. Records/end summaries and all segment/cancellation
bounds are unchanged. Readers must recognize the header version and search context.
