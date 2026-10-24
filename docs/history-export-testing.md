# Native command export verification

Owner: history-export.test.ts, scripts/verify-history-export.mjs and the independent
archive gate. Run pnpm test:history-export for the focused native/browser gate,
pnpm test for source cases, pnpm test:console for all browser gates and
pnpm test:command-app for the shipped application.

Nine source cases cover copied selection, multi-page traversal, explicit metadata
projection, real default 10,000-row bounds, exact continuation, page/UTF-8 byte limits,
whole-page rejection, empty output, malformed metadata/cursors, duplicate rows,
repeated cursors, cancellation/late completion, two-minute deadline and later-page
authorization/network failure. Failed attempts return no downloadable text result.

The browser gate owns native PostgreSQL, real scrypt accounts, restricted runtime
credentials and a TCP application with built assets. It creates 103 member commands
and two peer commands through the real API. Actual browser downloads are parsed
line by line: empty, all, pending, failed and pruned/unavailable selections preserve
the exact account projection, and the explicit operator selection includes peers.
No successful response or downloaded file is fabricated.

An owner-only bulk fixture adds 10,001 native jobs and command rows with the actual
fixed queue, association and owner invariants. The browser downloads its real first
10,000-row segment and continues to the remaining 104 member commands. Their union
matches all 10,104 owned IDs with no overlap or omissions in the retained fixture.
Both files stay within the actual UTF-8 byte cap. This retained fixture proves
continuation; it does not claim a live multi-page database snapshot.

Held completed reads prove cancellation and navigation/filter/scope cleanup. A
later-page network failure, live cookie switch, scoped session revocation and
operator withdrawal each produce no download from the failed attempt. A role
change is real store provisioning and revokes old sessions. Download filenames,
metadata fields and private-value exclusion are asserted from the actual files.

Eight states across light/dark desktop/phone plus two 130% phone captures produce
34 frames under ignored .artifacts/console/export (LONGHORN_EXPORT_QA_DIR override).
accessibility.json requires zero axe WCAG 2/2.1 A/AA violations; export-proof.json
records the retained fixture counts and segment boundaries. Captures use real
time and check overflow, keyboard focus and page errors. Other engines, physical
assistive technology and operating-system download dialogs remain manual checks.

The relocated, frozen-installed archive restores/regrants/restarts its real state,
reruns a saved command and exports exactly its four retained/new commands through
the shipped browser. Its file excludes numbers, payload and lease tokens. Existing
history, follow, recovery and account proofs remain separate. See [feature](history-export.md),
[format](history-export-format.md), [lifetime](history-export-lifecycle.md) and
[archive verification](command-app-testing.md).
