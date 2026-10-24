# Bind console requests to the displayed account

Owner: `examples/postgres/src/viewer-binding.ts`, configured immediately after
cookie authentication in the PostgreSQL accounts adapter, plus the console API
helper. Applies to the command application's `/account` API, including command,
receipt and operator routes. The generic framework CookieAuth and standalone
native SQLite auth APIs keep their existing interfaces.

A browser tab holds its displayed user in memory, but cookies are shared between
tabs. Without a consistency check, an old tab could read another active account's
history or submit its filled form under a newly switched cookie. Native browser
verification reproduced the old behavior as a real 201 command creation under the
switched account. This feature rejects that stale view before private handlers.

Once the console knows its user, each API call sends `X-LongHorn-Viewer` containing
that displayed user ID. It is a public consistency claim, never a credential or
owner/role selector. The server authenticates the actual cookie first, then compares
the claim to that principal. Anonymous claims get ordinary 401. A mismatched claim
with a valid different principal gets 401 with static `code: "VIEWER_CHANGED"` and
no private payload or reflected claim. The valid other-account cookie is preserved;
the check does not sign another tab out.

The console clears private UI and says the active account changed, with sign-in or
reload guidance. It does not automatically replay a read or mutation. Reload
performs a fresh session bootstrap without a prior-viewer claim, so it can adopt
the current account. Explicit sign-in likewise starts without an old displayed
principal. Password/session action handlers retain the mismatch guidance rather
than incorrectly saying the valid other session ended.

Calls without this optional header retain normal API behavior. Matching claims
never change the cookie-derived principal, owner predicates, current roles or
transaction-owned mutation checks. Spoofing another ID cannot grant access, and
no claim can authenticate an anonymous request. Ingress/proxies serving this
console must forward the header unchanged for the consistency check to work.
It is a single exact ID; cookies, usernames and secrets are not placed in it.

This is request-admission consistency, not push synchronization or cancellation of
already accepted requests. A role/session change still follows existing admission
and transaction rules. GET responses admitted before a switch cannot be unread;
normal navigation cancellation/version checks still prevent stale page replacement.
Only theme is persisted; no auth marker or session secret is put in browser storage.

Source tests verify matching/omitted claims, rejection before handlers, anonymous
claims, static errors and absence of cookie clearing. The native
[browser gate](command-rerun-testing.md) swaps actual isolated browser cookies while
an old review form is open, requires 401/no new command, verifies the other cookie
and history remain, then verifies the same protection for stale history reads. The account gate also
checks password-specific and session-action 401 paths preserve this guidance and
the valid other account.
See [rerun](command-rerun.md), [browser security](console-security.md),
[auth HTTP](auth-http.md) and [feature connections](features.md).
