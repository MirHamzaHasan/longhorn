# Recovery audit export

Owner: examples/postgres/console/audit-export.ts and auditExportControls in app.ts.
Connects [audit HTTP](outbox-audit-http.md), [stored history](outbox-audit-history.md),
[shared bounds](bounded-page-export.md), [format](recovery-audit-export-format.md),
[controls and lifetime](console-audit-export.md) and [native proof](recovery-audit-export-testing.md).

An authenticated numbers-operator can download recovery actions from Recovery
audit, across all deliveries or for the delivery in the current route. Export audit
starts from the oldest matching action, independently of currently loaded list
rows. An empty admitted selection produces a valid empty file. The queue is fixed
to outbox.command.numbers.v1; no queue/actor/owner claim is accepted from a form.

Each file contains the attributed actor, reason, requested allowance/time, recorded
outcome and recorded result metadata. Scheduled, conflict, budget-exhausted and
missing outcomes are preserved. Missing has a null result. Audit snapshots remain
exportable after delivery pruning; the exporter does not fetch or merge a current
delivery. Actor values are the API's public `user:<account ID>` attribution.

The API checks the current session, displayed viewer and operator role on every
page. An admitted read may finish under its original admission; later pages must
pass again. Cancellation, timeout, authorization/network failure or malformed data
discard the entire current segment. No file is initiated for that failed attempt.
No endpoint, schema, grant, dependency or mutation is added.

Files are bounded NDJSON segments with explicit continuation, held in memory only
until downloaded. They contain no command numbers, payload, lease token, password,
session credential/digest or raw exception. They are private operator metadata and
include actor IDs. The browser chooses the local save destination. This format is
separate from [command export](history-export.md) and [offline backup](command-app-backup.md).

Audit pagination is ascending createdAt/id. Each page is a live read: new actions
may appear during traversal, retention may remove rows, and late commits before
the cursor may be missed. complete means cursor exhaustion for this traversal,
not a database snapshot or a total-count guarantee. The file cannot be imported
to restore state. Future receipt exports remain separate work.
