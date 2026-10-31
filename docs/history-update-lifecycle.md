# Command history update lifetime

See the [development handoff](development-handoff.md) for the last verification.

Owner: createHistoryList, reusing the existing [follow controller](command-follow-lifecycle.md).
Connects [window protocol](command-history-updates.md), [controls](console-history-updates.md)
and [native proof](history-update-testing.md).

A page owns its timer, AbortControllers, loaded capacity/cursor and keyed DOM rows.
It waits five seconds after each settled cycle before the next, has one cycle in
flight, and stops after 24 checks or two minutes of elapsed wall time. Two-page
windows permit at most 48 automatic GETs in one run; ordinary windows need fewer.
Initial reads and explicit manual paging are separate user actions. Each request
also retains the console's 15-second deadline. The run deadline cancels an active
cycle, even when paused or a provider ignores cancellation until later.

Hidden/offline events pause admission and cancel the active automatic read. Returning
visible/online resumes the remaining original budget. Explicit Pause stops the run;
Resume/Check again starts a new bounded budget. Loading older rows temporarily
pauses the run, cancels and joins its client cycle before reading continuation,
and resumes with the original deadline. Crossing the 200-row live-window boundary
stops automatic work; it does not remove manually loaded rows.

Navigation, filter/search/scope changes, pagehide and sign-out dispose the run and
abort ordinary reads. Version and signal checks fence late results. Cursors and
row identities belong only to their admitted page. Browser cancellation cannot
promise cancellation of SQL already accepted by the HTTP host; its established
request drain still owns that work before database release.

Network, decoding, timeout or protocol failures stop automatic work and preserve
the last admitted display with an explicit retry. Expired/cookie-switched sessions
use the existing sign-in transition. Fresh operator denial clears previously shown
rows and offers the same filters scoped to the account's own history. No background
failure silently restarts or resets a deadline. Export and command-detail lifetimes
remain separately owned by their existing controllers.
