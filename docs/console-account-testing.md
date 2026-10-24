# Native browser account verification

Owner: `scripts/verify-console-account.mjs`. Run `pnpm test:console:account`, or
`pnpm test:console` for both the original command/recovery gate and this gate.
Install Chromium with `pnpm exec playwright install chromium` first.

The gate owns a native PostgreSQL cluster, restricted runtime accounts, two actual
TCP hosts with password mutation enabled/disabled, native scrypt and isolated
Chromium contexts. It uses built console assets and the actual cookie/origin APIs.
It never fabricates a successful auth/password response. A one-shot request fault
sends an invalid replacement to the actual server to exercise its 400 response.
A real completed response is held/dropped to inspect pending and uncertain states.

Verified behavior includes:

- Authenticated navigation and unavailable-capability fallback; signed-out users
  cannot reach a password form.
- Unicode length, unchanged-password and confirmation validation before any POST,
  exact trailing-space credentials through replacement and subsequent sign-in.
- Actual wrong-current-password 401 followed by a successful session probe, empty
  controls and retained sign-in; actual revoked-session 401 clears private UI.
- A held real 204, duplicate submit rejection, navigation/reentry while pending,
  disabled sign-in/sign-out, and revocation observed by the second browser session.
- Successful reauthentication with the new password and rejection of the old one.
- A dropped committed response with no replay, plus the real 15-second browser
  deadline followed by a late native success that cannot change the uncertain UI.
- A delayed wrong-current-password response after navigation, without stale-form
  restoration; the account remains usable after the fresh session check.
- Actual durable account throttling after ten wrong attempts, visible Retry-After
  guidance and a retained valid session.
- Detached input clearing, pagehide private DOM removal, a fresh session on reload,
  password autocomplete, keyboard order, cookie privacy and theme-only storage.

The gate records 58 screenshots and `accessibility.json` under ignored
`.artifacts/console/account` (`LONGHORN_ACCOUNT_QA_DIR` overrides it). Account, session controls,
validation, wrong-password, pending, success, expiry, uncertain, disabled, throttle
and timeout states use light/dark themes at 1360/390px widths; 130% text is checked
in both themes on phone width. It requires no horizontal overflow, no browser page
errors and zero axe WCAG 2 A/AA and 2.1 A/AA violations. Reduced motion is enabled.

Screenshots are visually checked for readable copy, form/error wrapping, focus,
responsive navigation and loading feedback. There is no new transition animation
to sample. This is Chromium evidence; physical-device touch, VoiceOver/TalkBack,
password-manager applications and other browser engines remain manual checks.

The [independent archive gate](command-app-testing.md) also changes a password
through the shipped Account form after an actual offline restore and function
regrant. The native [password gate](password-change-testing.md) remains responsible
for SQL/concurrency/expiry/crash durability; browser tests do not replace it.
CI runs both browser gates and retains nested captures through the existing
[review artifact](ci-review-artifacts.md) job, subject to hosted availability.

[Session controls](console-session-controls.md) add four states (16 captures):
held other-session deletion, completed others, all-device sign-out and dropped
committed all-device response. The gate verifies current/unrelated account
preservation, zero-other feedback, shared password/session exclusion, navigation
and no automatic retry.
