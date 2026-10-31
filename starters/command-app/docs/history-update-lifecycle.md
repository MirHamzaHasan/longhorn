# History read ownership

The page owns one settled automatic cycle at a time, five seconds apart, bounded
by 24 checks or two minutes. Up to 200 visible rows require at most two 100-row GETs
per cycle; each request retains the 15-second timeout. Hidden/offline events cancel
and pause with the original deadline; returning visible/online does not refill it.
Explicit pause/resume starts a new budget only on the person's request.

Manual paging pauses and joins the client cycle before continuing. Loading more
than 200 rows stops automatic checks and leaves explicit paging available. Route,
filter/search/scope changes, pagehide and sign-out dispose timers, signals and old
cursor/row state. Late responses cannot overwrite another page. A canceled browser
request may still have accepted SQL; the application's existing drain owns it.

Network/protocol failures stop and retain the last display with a retry. Expired or
cookie-switched sessions return to sign-in; operator denial clears old rows. No
private metadata/cursor is stored in links, localStorage or sessionStorage. Exports
and command-detail receipt following keep their separate lifetimes.

Connects [feature](history-updates.md), [lifecycle](lifecycle.md),
[account controls](session-inventory-lifecycle.md) and [backups](backup.md).
