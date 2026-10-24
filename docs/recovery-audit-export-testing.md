# Native audit export verification

Owner: console/audit-export.test.ts, history-export.test.ts,
scripts/verify-audit-export.mjs and scripts/verify-command-app.mjs. Run
pnpm test:audit-export for the focused native/browser gate, pnpm test for source
cases, pnpm test:console for the browser suite and pnpm test:command-app for the
independent archive.

Seven audit source cases cover all outcomes, missing/pruned result snapshots,
explicit field projection, copied selection, queue/delivery mismatch, empty files,
row/page/UTF-8 limits and exact continuation, invalid fields/pages, repeated
cursors/IDs, later authorization loss, cancellation and deadline with late readers.
The ten existing command-export cases also exercise the shared engine, including
its actual 10,000-record default and searched v2/unsearched v1 compatibility.

The new browser gate owns native PostgreSQL, real scrypt accounts, restricted
application credentials and a TCP host with built assets. It makes real command
writes, exhausts delivery attempts through the native Outbox dispatcher, and makes
105 actual HTTP recovery requests. All four outcomes are recorded with the real
operator's `user:<ID>` actor. No successful response or downloaded file is fabricated.
Owner-only maintenance prunes one failed delivery through the existing store port;
runtime DELETE grants remain absent. Its audit snapshot still downloads.

Actual browser files prove empty, global, 103-action delivery scope and pruned/missing
selections. Global/scoped downloads cross the 100-row API page boundary, match the
recorded IDs/fields and exclude private payload/credentials. Held admitted reads
prove keyboard cancellation, navigation and scope cleanup, including canceled
list pagination without a stale announcement. A later-page network
failure, actual role withdrawal/session revocation and a switched cookie each
produce no current file. Viewer headers, temporary URL revocation, focus and page
errors are checked.

Eight states in light/dark at desktop/phone widths and two 130% phone frames produce
34 captures under ignored .artifacts/console/audit-export (LONGHORN_AUDIT_EXPORT_QA_DIR
override). accessibility.json requires zero axe WCAG 2/2.1 A/AA violations and no
horizontal overflow. audit-export-proof.json records the native counts/outcomes.
Physical assistive technology, other browser engines and OS save dialogs remain
manual checks.

The existing command-export browser gate verifies an actual 10,000-row segment and
its exact remainder through the shared collector/control. Audit-specific browser
scale here is 105 records; smaller audit source bounds cover its continuation.
The independently relocated/frozen-installed archive restores/regrants/restarts
state, then downloads the exact retained audit record through the shipped operator
screen. Existing command v1/v2 exports and other console flows remain regression
gates. See [feature](recovery-audit-export.md), [format](recovery-audit-export-format.md)
and [lifetime](console-audit-export.md).
