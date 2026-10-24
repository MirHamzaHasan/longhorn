# Displayed account consistency

Owner: src/viewer-binding.ts and the console API helper, configured after cookie
authentication on `/account` routes. Browser cookies are shared across tabs while
each tab holds its displayed user in memory. An old form must not silently read or
submit under a newly switched account.

Once its user is known, the console sends `X-LongHorn-Viewer` with that public user
ID. The server authenticates the real cookie first and compares the claim. An
anonymous claim gets 401; a mismatched authenticated claim gets 401 with static
`code: "VIEWER_CHANGED"`, before private handlers. The valid other-account cookie
is preserved. The console clears private UI and offers sign-in/reload guidance,
without automatically repeating the request. Reload adopts the current session;
explicit sign-in likewise does not carry an old displayed-user claim.

This optional header grants no identity, owner filter or role. Matching claims
leave normal cookie/owner/transaction authorization in control; clients without
claims keep normal API behavior. Proxies serving this console must forward the
header unchanged. It contains no cookie, password or session token. Claims and
other-account data are never reflected in mismatch responses.

This is admission consistency, not push account synchronization or retroactive
cancellation of already accepted work. Existing role/session and transaction rules
remain authoritative. It does not modify the framework's generic CookieAuth API.
Native browser tests reproduced the prior switched-account 201, then require 401,
no new command, protected reads and the other cookie/history preserved. Source
cases cover matching/missing/mismatched/anonymous claims and no handler/cookie effect.
See [rerun](command-rerun.md), [console](console.md), [accounts](accounts.md) and
[feature connections](features.md).
