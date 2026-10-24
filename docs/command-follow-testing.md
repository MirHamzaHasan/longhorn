# Command update verification

Owner: command-follow.test.ts, scripts/verify-command-follow.mjs and the independent
command archive gate. Run pnpm test:command-follow for the focused native/browser
gate; pnpm test includes controller cases, pnpm test:console includes all browser
gates, and pnpm test:command-app verifies the shipped archive.

Seven source cases use a controlled clock and deferred readers to prove settlement-
relative scheduling, non-overlap, real AbortSignal cancellation, stale-generation
isolation, hidden/offline pause, elapsed budget while paused, check-count and active-
read deadline limits, explicit restart, error stop and irreversible disposal.
These test behavioral ownership/races rather than a duplicate timer implementation.

The dedicated browser gate owns native PostgreSQL, restricted runtime credentials,
actual scrypt accounts, the production broker/receipt Object and a TCP application
serving built assets. The gate owns real Outbox dispatch timing; successful command,
status and receipt responses are never fabricated. Chromium observes pending state,
pauses/resumes, receives a computed receipt without Refresh status and stops reading.
Keyboard focus stays on the completion control. Separate real jobs prove terminal
failure and metadata pruning, including retained delivery identity.

A receipt transport fixture returns a real HTTP 503, and a browser fault aborts
one actual request. Both stop rather than retry automatically. A held completed
server response is canceled through a visibility-event fixture and through actual
route navigation. Browser network emulation supplies real offline/online events;
no reads occur while paused. Cookie switching and owner-side session deletion
exercise actual viewer-mismatch/expired-session 401 responses, private DOM clearing
and preservation of the peer's valid cookie. Follow performs no command POST.

The visibility event is a controlled document-state fixture, not proof of operating-
system background throttling. Controller clock tests prove both budgets without
waiting two real minutes; browser captures use real time. Six states in light/dark
at desktop/phone widths plus two 130% phone captures produce 26 frames under ignored
.artifacts/console/follow (LONGHORN_FOLLOW_QA_DIR overrides it). accessibility.json
requires zero axe WCAG 2/2.1 A/AA violations; overflow, focus and page errors are
checked. Physical-device assistive technology, browser suspension and other engines
remain manual checks. Existing command/account suites retain 117/58 captures.

The relocated, frozen-installed archive follows its genuinely failed command while
the operator recovers it through the existing API. Its shipped detail receives the
actual computed receipt without manual refresh before both processes restart.
Existing backup/restore, grants, saved-command reuse and account controls remain
part of the same gate. See [update policy](command-live-updates.md),
[lifetime](command-follow-lifecycle.md) and [archive verification](command-app-testing.md).
