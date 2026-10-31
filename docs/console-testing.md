# Native console verification

Owner: `scripts/verify-console.mjs`. Run:

```sh
pnpm exec playwright install chromium
pnpm test:console
```

Cross-browser verification can also target Firefox and WebKit (Safari engine):

```sh
pnpm exec playwright install firefox webkit
pnpm test:console:firefox
pnpm test:console:webkit
```

The gate owns a temporary native PostgreSQL cluster, restricted runtime account,
actual scrypt passwords, local broker and production receipt Object. Chromium
uses the built browser assets over an actual TCP listener with matching Origin.
No successful command or receipt response is fabricated. Test fault injection
holds a real response for loading capture and drops a real committed response
to prove one command after a same-key retry.

Verified flows include registration/sign-in, empty/history pages, create/detail,
computed receipts, browser reload, delivery outage, operator recovery and audit,
stale retry conflict, member denial, logout and revoked-session clearing. Source
tests separately verify asset/CSP boundaries. Existing native history and account
gates retain their concurrency, migration and SQL privilege coverage.

The gate writes 117 real screenshots and `accessibility.json` into
`.artifacts/console` by default (`LONGHORN_QA_DIR` overrides it). It captures light
and dark themes at 1360px and 390px widths, loading/empty/error states, plus 130%
text at phone width. Captured screens run axe WCAG 2 A/AA and 2.1 A/AA checks
with zero violations required. It checks no horizontal overflow, keyboard skip
navigation, account cookie properties, browser secret storage and page errors.
Reduced motion is enabled; no functional feedback depends on animation.

The current captures were visually reviewed for readable text, wrapping, focus,
form controls, data rows and responsive navigation across Chromium, Firefox and WebKit (Safari).
Styles normalize Firefox button inner padding (`::-moz-focus-inner`), search input appearance,
and cross-platform monospace stacks. Real-device VoiceOver/TalkBack and physical-device touch
sizing still require manual verification. Artifacts contain test account IDs only and are ignored by source control.

`pnpm test:console` also runs the separate [account gate](console-account-testing.md),
with 58 additional screenshots under `.artifacts/console/account`, real password
replacement/throttling/session revocation, dropped responses and the real browser
deadline. The command/recovery/reuse/filter gate now has 117 captures.

[Command reuse and viewer consistency](command-rerun-testing.md) add real source
review, new receipts, edited/manual replay, scope/legacy failure, loading/navigation
and switched-account rejection. Saved-source fault injection changes only an owned
test row; its real GET supplies the malformed data. Six new states plus two
130% review captures account for 26 additional frames.

[History filtering](history-filter-testing.md) adds real status/scope changes,
missing metadata, filtered pagination/cancellation and recovered membership.
Its six states and two scaled phone captures contribute another 26 frames.

`pnpm test:console` also runs [command following](command-follow-testing.md), which
writes 26 additional captures under `.artifacts/console/follow`. Its actual broker
receipt arrives without Refresh status; pause/resume, terminal/error stop, focus,
canceled reads, offline and viewer/session boundaries use built browser assets.
The command, account and follow gates produce 201 captures, with separate reports.

[History export verification](history-export-testing.md) adds 34 captures under
`.artifacts/console/export` plus actual download/continuation assertions. The command, account, follow and export
suites produce 235 frames in separate reports; file contents are
checked independently of screenshots and are not hosted capture upload paths.

[Saved-view verification](history-view-link-testing.md) adds 26 captures under
`.artifacts/console/view-links`, real browser Back/Forward/reload, sign-in return,
invalid-link denial and actual saved-selection export. The command, view-link, export, follow and account suites
produce 261 captures with separate reports.

[ID search verification](history-search-testing.md) adds 26 captures under
`.artifacts/console/search`, actual prefix/status paging, cancellation, saved links,
operator admission and v2 downloads. The six browser suites produce 287 captures
in separate reports. Native migration/query-plan proof is a separate account gate.
