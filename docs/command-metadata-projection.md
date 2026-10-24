# Shared command metadata projection

Owner: projectCommandMetadata in examples/postgres/console/history-metadata.ts.
Connects [command-history files](history-export-format.md), [receipt files](receipt-export-format.md)
and the [bounded collector](bounded-page-export.md).

The app-local pure projector copies {id,createdAt,deliveryId,delivery}. Nullable
delivery metadata stays null. A present summary must have the matching retained
ID, a known queue state, safe nonnegative counts/times, allowance in 1..100 and a
null or recognized failure code. Text fields are bounded. The caller supplies its
domain error factory, preserving HistoryExportError and ReceiptExportError.

The helper never copies raw command numbers, owner IDs, payloads, lease tokens or
unknown response fields. It does not fetch, authorize or infer a receipt from
delivery state. Receipt export adds its own UUID and receipt-result validation;
ordinary command-history v1/v2 shapes and validation remain unchanged. Existing
history cases and [receipt cases](receipt-export-testing.md) exercise the same helper.
