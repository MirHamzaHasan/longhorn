# Native ID search verification

Owner: scripts/verify-history-search.mjs, verify-history-search-console.mjs and
the independent archive gate. Run pnpm test:history-search; pnpm test covers the
source cases and pnpm test:console includes the browser gate. Build once before
parallel underlying scripts; never clean-build while a gate reads compiled files.

Source cases cover bounded UUID-prefix normalization, rejected wildcard/escape/
payload input, compatible v1/v2 and exact v3 context, parameterized metadata SQL,
int64 seeking and input mutation while a read waits. Browser helpers cover strict
saved-query construction and copied searched-export v2 headers while preserving
ordinary v1 files.

The native gate starts from the exact previous complete migration profile. It
retains ledger checksums/business rows, holds new index DDL before commit, proves
peer invisibility and SIGKILL rollback, then verifies concurrent owner deployment
and missing-index readiness. Real Outbox claim/publication/retry produces pending,
running, succeeded and failed states. Pruning plus an unrelated queue row proves
unavailable association. Actual HTTP verifies owner/operator policy, malformed/
duplicate claims, normalized query spelling and role revocation.

A 6,000-row two-owner fixture uses actual command/job invariants, including an
uppercase stored UUID and positions above Number.MAX_SAFE_INTEGER. Saved v3
pagination continues after a real app restart and rejects changed search/state/
viewer context. A metadata-only role can query every combined state but cannot
SELECT numbers, payload or lease token. Actual owner/global EXPLAIN ANALYZE/BUFFERS
plans use both new indexes with the default planner; ignored
.artifacts/history-search-plans.json records them. The fixture does not claim a
universal latency bound or held database snapshot.

Chromium creates real accounts and commands, then adds an explicit native 25-row
shared-prefix fixture (23 member, two peer rows). It checks submit/invalid/empty
search, status composition, clear, paging/cancellation, reload/Back, detail return,
operator denial/admission and cold sign-in under another account. A real v2 NDJSON
download matches exactly the 23 owned search results and excludes secret fields.
No successful response or file is fabricated.

Six light/dark desktop/phone states plus two 130% phone captures produce 26 frames
under ignored .artifacts/console/search (LONGHORN_SEARCH_QA_DIR override).
accessibility.json requires zero axe WCAG 2/2.1 A/AA violations, no overflow and no
page errors. Screens are captured in real time; physical assistive technology,
other engines and OS download behavior remain manual checks. Existing browser
suites retain their separate reports.

The relocated/frozen-installed application restores/regrants/restarts, searches
one retained Delivered UUID, reloads its canonical searched view, exports exactly
that command with a v2 header and clears search back to four commands. Existing
history/filter native gates also retain their earlier upgrade and projection
proof while deploying the new appended suffix. See [API](history-id-search.md),
[cursor](history-search-cursors.md), [migration](history-search-migrations.md),
[console](console-history-search.md) and [file contract](history-search-export.md).
