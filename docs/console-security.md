# Console assets and account boundary

Owner: `examples/postgres/src/console.ts`, `console-assets.ts` and browser API helper.
The Node host reads fixed built files, then injects immutable script/style text
into the shared application. There is no request-selected filesystem path.
The console requires account operations before database acquisition.

The public HTML contains no private data or runtime configuration. `/console`,
`/console/`, `/console/app.js` and `/console/app.css` use no-store, nosniff,
no-referrer and a restrictive Content Security Policy. Scripts, styles and API
connections are same-origin; inline/eval scripts, framing, base overrides and
objects are denied. Browser text uses DOM textContent, never API-supplied HTML.
No third-party fonts, analytics or remote scripts are loaded.

Sign-in and registration use the existing exact-origin cookie APIs. Cookies are
HttpOnly and SameSite Strict; persistent deployment configuration requires Secure
cookies over HTTPS. The browser stores only its theme in localStorage. Password controls
are cleared on submission, navigation and pagehide; service credentials and database URLs never reach it.
Requests use relative API URLs and same-origin credentials. See [auth HTTP](auth-http.md).

Navigation visibility is a convenience. The server checks every principal,
owner predicate and operator permission. UUID route validation prevents hash
input from selecting arbitrary API paths. An ordinary protected-request 401 clears displayed account data,
hides authenticated navigation and renders sign-in. Another tab or a trusted
role/session change is observed on the next API request, not by a push channel.
Protected mutations retain the existing transaction-locked reauthentication.

[Source tests](../examples/postgres/src/console.test.ts) verify fixed assets,
policy headers, lack of request reflection, unknown-file denial and configuration
guards. [Native browser tests](console-testing.md) exercise actual cookies,
storage, member/operator restrictions and session expiry.

[Account password settings](console-account.md) handle reauthentication 401 with
a fresh same-subject session check before retaining private UI. Only this operation
and its probe bypass automatic 401 clearing. The shell advertises one host-owned
boolean capability. Pending auth changes block another password submission, login
and logout; an unconfirmed mutation is never replayed. pagehide removes private DOM
and a restored back/forward-cache page reloads to revalidate its session. See
[account browser proof](console-account-testing.md).
