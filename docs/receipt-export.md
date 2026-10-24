# Computed receipt export

Owner: examples/postgres/console/receipt-export.ts and receiptExportView in app.ts.
Connects [protected receipts](operator-receipt-transport.md), [history](account-command-history.md),
[file format](receipt-export-format.md), [lifetime](receipt-export-lifecycle.md),
[controls](console-receipt-export.md) and [native proof](receipt-export-testing.md).

Members can download computed results for their selected command history or one
command. Current numbers-operators can explicitly choose All commands and export
that history. Scope, delivery state and normalized ID search are copied into the
file selection and used on every history page. An admitted empty history produces
a valid zero-command file. A direct command export requires that exact command.

Each file has one row per selected command: safe command/delivery metadata and a
receipt observation. A successful protected receipt response contributes its real
message IDs and count/sum/min/max results. A protected 404 contributes not-found.
Delivery success, failure or pruned metadata does not decide receipt availability;
the exporter reads the actual receipt endpoint for every command.

not-found describes the HTTP observation. It can mean that no receipt exists yet
or the command is no longer available under current ownership. It does not claim
that delivery is pending, failed or permanently unable to produce a receipt. Other
errors stop the current segment without initiating a file. The exporter never
submits a command, dispatches a delivery or schedules recovery.

History and receipt reads independently apply current cookie/viewer and owner/role
admission. The receiver capability stays on the server. The browser sends no actor,
owner or queue claim. Files omit raw command numbers, payloads, lease tokens,
passwords, session credentials/digests and remote diagnostics. Computed aggregates
are private command data; the user chooses where to save them locally.

Receipt segments are smaller than metadata exports: up to 1,000 commands, ten
history pages, 100 commands per page, 8 MiB and two minutes per attempt. Each command
has at most 100 receipt entries. Explicit continuation resumes at the last accepted
history page. Each read is live; metadata and receipts are not one database snapshot.
The protocol is separate from [command metadata](history-export.md), [audit files](recovery-audit-export.md)
and [offline backup](command-app-backup.md), and does not support import/restore.
