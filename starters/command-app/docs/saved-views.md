# Save personal history views

Owner: src/history-views.ts, history-views-http.ts, history-view-values.ts,
history-view-migrations.ts and console/app.ts. Connects [history](history.md),
[canonical URLs](history-view-links.md), [viewer checks](viewer-binding.md),
[deployment](schema.md) and [backup](backup.md).

Open Saved views in Commands to name the current scope/status/ID search. Save view
creates a preference; choosing a name reopens those filters. Open view reapplies
its saved filters. Update view changes the name/current filters, Delete view removes
the preference, and Refresh views reads current revisions. Filter URLs continue
working after deletion. Each account owns at most 20 views; operators cannot manage
another account's personal preferences. An all-scope preference requires current
operator authority when saved/updated and never preserves old history access.

Names trim/NFC normalize and accept 1..80 Unicode code points without controls or
lone surrogates. Exact normalized names are unique per account, preserving case.
Selection has only scope, state and optional canonical UUID-prefix q. There are no
commands, payloads, results, cursors or export continuation in the saved data.

The protected /account/history-views API supports GET list/detail, POST create,
PUT update and DELETE. Create accepts {id,name,selection}; updates accept
{requestId,expectedRevision,name,selection}; deletes accept {requestId,expectedRevision}.
UUID keys are scoped by account/action/resource. Stable unchanged retries replay
committed responses for the existing 24-hour window. Replays can describe an older
or deleted record and never resurrect it; GET/list is current. Revision conflicts
require refresh. Current filters do not save automatically.

Writes reauthenticate inside the managed Idempotency transaction. Create uses an
account-specific transaction advisory lock before quota counting. Updates/deletes
use owner/revision SQL predicates. Business state and response commit together;
navigation cannot undo an accepted commit. The browser fences late callbacks,
clears private form text and keeps draft/request state only in page memory.

Deploy the appended postgres_account_operations/005_history_views migration after
the complete old profile and rerun provision:runtime for the new table's CRUD grants.
Existing auth-user/audit/DDL restrictions stay intact. Startup checks columns and
runtime grants; it never deploys automatically. Backup/restore includes preferences,
while deleted replies can remain in replay retention/checkpoints. The 24-hour
window controls replay eligibility; expired rows need explicit idempotency pruning
or key reuse for physical cleanup. Active records
do not expire automatically. Sharing and account-retention maintenance are separate.
