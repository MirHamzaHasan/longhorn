# Native saved-view verification

Owner: history-view-values.test.ts, scripts/verify-history-views.mjs,
verify-history-views-console.mjs and the independent archive gate. Run
pnpm test:history-views for focused native/browser proof, pnpm test for source cases,
pnpm test:console for browser regressions and pnpm test:command-app for distribution.

Six value cases cover NFC/trim/case, 80-code-point Unicode names, raw/control/lone-
surrogate bounds, plain text, copied filters, unknown owner/cursor/destination claims
and non-string/prefix rejection. Existing search/export cases still use the moved
pure search helper. The native browser verifies no SQL/auth server code enters
the console bundle.

The PostgreSQL gate deploys the exact previous profile, retains a command/checksum
ledger, kills owner DDL before commit and races two owner upgrades. It verifies the
new table/checks and runtime grants/readiness. Real accounts/HTTP exercise owner
isolation even for operators, normalized replay, wrong-input key conflicts,
revision races, no-op updates and stale deletes. An old create replay after deletion
returns its original response while the active record remains absent.

Two native hosts race for the twentieth slot; a dedicated transaction advisory
lock permits one winner. A real business constraint failure rolls back both view
and replay result. A separate process is SIGKILLed after authenticated view/result
writes but before commit; the row stays invisible and HTTP retry creates it once.
Session revocation while waiting on actual transaction ownership denies the write.
Role withdrawal retains personal preferences while all-scope use/save is denied.
Host restart preserves records and sessions.

The browser owns native PostgreSQL, scrypt accounts and built TCP assets. It proves
CRUD, canonical filter reopening after server restart/in a second session, actual
selected export, stale edit/delete errors, an aborted committed response with
same-key recovery, cookie-switch isolation, role denial, quota/long Unicode names,
optional preference-load failure, canceled reads and late committed navigation.
No successful response or saved record is fabricated.

Thirteen states in light/dark desktop/phone and two 130% phone frames produce 54
captures under ignored .artifacts/console/saved-views (LONGHORN_SAVED_VIEWS_QA_DIR
override). accessibility.json requires zero axe WCAG 2/2.1 A/AA violations and no
horizontal overflow. Native/browser proof JSON records actual outcomes. Other
engines, physical assistive technology and real-device font/target measurements
remain manual checks.

The relocated/frozen-installed archive must ship the shared values, schema,
repository/router and its own guide. Its real offline checkpoint/restore retains
a named view, which a fresh password-authenticated browser reopens and updates.
History, receipt/audit export and account flows remain regression gates. See
[feature](saved-history-views.md), [schema](saved-view-migrations.md),
[ownership](saved-view-concurrency.md) and [UI](console-saved-views.md).
