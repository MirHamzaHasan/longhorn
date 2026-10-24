# Shared bounded page export

Owner: examples/postgres/console/bounded-export.ts. Connects the domain wrappers
[command history](history-export.md), [recovery audit](recovery-audit-export.md) and
[computed receipts](receipt-export.md),
their file formats and the page-owned controls in console/app.ts.

collectBoundedExport is an app-local pure Web helper. A trusted wrapper supplies
the response array key, closed metadata projector, header/record encoders and
domain error messages. Line construction may asynchronously enrich a validated
record through a domain-owned protected reader. The helper awaits these serially
with its signal, checks activity before/after each, and validates all page metadata/
IDs/cursors before enrichment. The helper owns sequential pagination, duplicate IDs,
cursor validation, whole-page acceptance, limits and cancellation. This adds no
framework package or dependency. Domain authorization stays in the existing API.

Common defaults are 10,000 records, 100 pages, at most 100 records per request, 8 MiB of
UTF-8 output and two minutes per attempt. Limits must be positive safe integers;
the page size cannot exceed 100. Receipt export applies smaller 1,000-command/
ten-history-page limits because each command adds a protected receipt request. The byte budget reserves 4 KiB for the trailer
and bounded cursor. A rejected page retains the previous accepted cursor; an
oversized first page fails. The final file size is checked again before returning.

Each nonfinal page must be full. Cursors are null or bounded base64url strings;
repeated cursors and duplicate IDs fail the whole segment. The final summary gives
this segment's count, complete, reason and nextCursor. Row/page/byte limits return
an explicit continuation. Empty exhausted selections return a zero-record file.

The helper joins external cancellation with its own fixed deadline and checks
activity before/after reads, after progress and before returning. A late response
cannot become a successful result after cancellation/deadline. Readers must honor
the supplied signal to stop underlying work promptly. All timers/listeners are
released on settlement, including projection/header failure. Browser requests also
retain their existing 15-second deadlines.

No text result escapes a failed/canceled attempt. Previously downloaded segments
are independent. The shared UI owns temporary Blob URLs, subject/route fencing,
cancel/continue/start-over controls and polite progress. The helper performs no
Fetch, DOM, storage or filesystem operation. Command v1/v2 headers and projections
remain owned by history-export.ts; audit v1 is owned by audit-export.ts, and command-receipts v1 by receipt-export.ts.
[Shared command metadata](command-metadata-projection.md) keeps the ordinary and
computed-result file projections consistent. See
[audit verification](recovery-audit-export-testing.md) and [history verification](history-export-testing.md).
