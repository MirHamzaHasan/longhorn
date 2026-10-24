# Native computed receipt export verification

Owner: console/receipt-export.test.ts, scripts/verify-receipt-export.mjs and the
independent archive gate. Run pnpm test:receipt-export for the focused built/native
gate, pnpm test for source cases, pnpm test:console for all browser suites and
pnpm test:command-app for the relocated application.

Fourteen receipt source cases cover copied scope/status/search, closed metadata/
result projection, serial reads, not-found observations, retained receipts with
missing delivery metadata, the real 1,000-command default and exact continuation,
smaller row/page/byte bounds, empty histories, exact single-command binding,
invalid selections/limits/fields, duplicate IDs/cursors, later authorization/service
failure, canceled late readers and a deadline during enrichment. Existing history
and audit cases also exercise the shared collector's asynchronous line path.

The browser gate owns native PostgreSQL, restricted application credentials, real
scrypt accounts, TCP HTTP and a real workerd broker/receipt consumer. It creates
1,002 commands through HTTP, including one peer command. Two actual publishes
produce computed receipts. Owner-only store maintenance prunes succeeded delivery
metadata while retained receipts remain readable. An anonymous/other-owner denial
is checked before the receiver is contacted. Successful files are never fabricated.

Actual downloads prove single-command and selected history, not-found rows,
status/search selection and explicit operator inclusion of peer results. A real
1,000-command segment and its one-command remainder cover all 1,001 member IDs
without overlap/omission in the retained fixture. Both files obey the byte bound.
This proves retained continuation, not a live multi-request snapshot.

Held real receipt responses prove keyboard cancel, export-type switching,
navigation with simultaneous follow/export ownership and fresh role/session/viewer
denial. Network aborts and a disposed real receiver stop export without a current
file. Start over returns focus; temporary Blob URLs, page errors and displayed
viewer headers are checked. No exporting action submits or recovers a command.

Eleven states in light/dark desktop/phone plus two 130% phone frames produce 46
captures under ignored .artifacts/console/receipt-export (LONGHORN_RECEIPT_EXPORT_QA_DIR
override). accessibility.json requires zero axe WCAG 2/2.1 A/AA violations and no
horizontal overflow. receipt-export-proof.json records native counts, continuation
boundaries and actual computed results. Other engines, physical assistive
technology, real-device text/target sizes and OS save dialogs remain manual checks.

The independently relocated/frozen-installed archive typechecks/tests/builds its
shipped helpers and guide, restores/regrants/restarts real state, and downloads
both its four command receipts and one protected command receipt. Results match
the actual restored/new computations. Command-history v1/v2 and audit exports
remain regression gates. See [feature](receipt-export.md), [format](receipt-export-format.md),
[lifetime](receipt-export-lifecycle.md) and [controls](console-receipt-export.md).
