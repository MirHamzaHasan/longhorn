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
and its probe bypass automatic 401 clearing. The shell advertises host-owned
boolean password/session capabilities. Pending auth changes block another password submission, login
and logout; an unconfirmed mutation is never replayed. pagehide removes private DOM
and a restored back/forward-cache page reloads to revalidate its session. See
[account browser proof](console-account-testing.md).

[Session controls](console-session-controls.md) use the same account mutation gate
and strict token-owned API. Only the server selects the subject. Live count results
contain no session digest or other-account metadata. The browser never replays an
unconfirmed deletion.

The [viewer consistency check](console-viewer-binding.md) binds admitted console
requests to the displayed public user ID. Cookies still authenticate; the header
never selects an owner or grants a role. Switched-cookie views fail before private
handlers and preserve the valid other-account cookie.
[Saved command reviews](command-rerun.md) keep copied numbers/request keys in memory
only and use the normal owner-scoped read plus transaction-authenticated write.

[Command following](command-follow-lifecycle.md) joins a cycle AbortSignal with the
ordinary page-read signal. It checks cancellation before handling a response's
status or data, disposes listeners/timers on navigation and never submits a mutation.
A hidden/offline tab pauses within a fixed bounded run; active 401 responses retain
the existing session/viewer clearing policy.

[History export](history-export-lifecycle.md) uses the existing protected reads,
keeps segment text/cursors in memory and discards the current file after any failed
admission. Route/version/subject checks precede download. Temporary Blob URLs are
revoked; export adds no persistent browser data or external transmission.

[View links](history-view-links.md) accept only scope/status and a validated UUID prefix on the list route.
Unknown/duplicate claims and arbitrary return destinations are rejected. The
[sign-in target](history-view-sign-in.md) is always an internal serialized view;
links supply no actor, user ID, cursor or permission. Explicit all scope still
reaches the server gate for a member and produces denial rather than silent
own-scope reinterpretation. Normal browser history retains filter choices, including an explicitly submitted ID prefix.
