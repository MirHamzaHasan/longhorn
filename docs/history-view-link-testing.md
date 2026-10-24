# Saved history view verification

Owner: console/routes.test.ts, scripts/verify-history-view-links.mjs and the
independent command archive gate. Run pnpm test:history-view-links for the focused
native/browser gate, pnpm test for source cases, pnpm test:console for the browser
regressions and pnpm test:command-app for shipped restore behavior.

Five source cases cover ordinary/legacy/UUID routes, all scope/status combinations,
canonical defaults/order/encoded names, duplicate/unknown claims, unsupported page
queries, malformed/extra path segments, size bounds and invalid constructor values.
Raw redirect/owner/queue/cursor/page-size claims are rejected before construction
or forwarding. The router remains a pure Web module with no runtime import.

The browser gate owns native PostgreSQL, real scrypt accounts, restricted runtime
credentials and built assets over TCP. It creates 23 member commands and a peer's
command through the actual API. Reload, Refresh, Back/Forward, Show all, detail/
creation return links and canonical legacy URLs preserve the intended selection.
Loaded older rows reset to a fresh first page; an actual NDJSON download exports
all 23 commands under the bookmarked pending filter, beyond the 20 visible rows.

A held completed older-page response is canceled during a filter change. Back
returns to a clean first page without stale rows/notices. Invalid queries render
the static failure state without issuing a command-list request. The bootstrap
session check remains independent. Real operator provisioning revokes old sessions;
reauthentication returns to the validated all-account view. A member following
that link receives actual 403 and explicitly opens their own matching view.

Cold sign-in, switching to registration, real all-session revocation and signing
in as a different account verify destination preservation and principal isolation.
Explicit logout resets the next ordinary sign-in. Browser storage stays theme-only.
No command/status response, successful download or authorization result is mocked.

Six states at light/dark desktop/phone plus two 130% phone captures produce 26
frames under ignored .artifacts/console/view-links (LONGHORN_VIEW_LINK_QA_DIR override).
accessibility.json requires zero axe WCAG 2/2.1 A/AA violations; page errors, overflow
and accessible controls are checked with actual Chromium. Physical assistive
technology, other engines and OS bookmark/sync interfaces remain manual checks.

The relocated, frozen-installed app restores/regrants/restarts its real state,
opens Delivered through its shipped console, reloads the actual saved fragment
and uses browser Back/Forward before exporting the four retained/new commands.
See [format](history-view-links.md), [navigation](console-history-navigation.md),
[sign-in](history-view-sign-in.md) and [archive proof](command-app-testing.md).
