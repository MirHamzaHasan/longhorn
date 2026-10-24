# Native console verification

Owner: `scripts/verify-console.mjs`. Run:

```sh
pnpm exec playwright install chromium
pnpm test:console
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

The gate writes 65 real screenshots and `accessibility.json` into
`.artifacts/console` by default (`LONGHORN_QA_DIR` overrides it). It captures light
and dark themes at 1360px and 390px widths, loading/empty/error states, plus 130%
text at phone width. Captured screens run axe WCAG 2 A/AA and 2.1 A/AA checks
with zero violations required. It checks no horizontal overflow, keyboard skip
navigation, account cookie properties, browser secret storage and page errors.
Reduced motion is enabled; no functional feedback depends on animation.

The current captures were visually reviewed for readable text, wrapping, focus,
form controls, data rows and responsive navigation. This verifies Chromium on the
development machine; real-device VoiceOver/TalkBack, other browser engines and
physical-device touch sizing still require manual verification. Artifacts contain
test account IDs only and are ignored by source control.

`pnpm test:console` also runs the separate [account gate](console-account-testing.md),
with 42 additional screenshots under `.artifacts/console/account`, real password
replacement/throttling/session revocation, dropped responses and the real browser
deadline. The original command/recovery gate remains 65 captures.
