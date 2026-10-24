# Page-owned command update lifetime

Owner: createCommandFollow, clearPageWork and the console API helper. Connects
[update behavior](command-live-updates.md), [application lifetime](lifecycle.md),
[viewer admission](console-viewer-binding.md) and [native proof](command-follow-testing.md).

The detail page creates one controller after its initial reads finish and its
render version is still current. The route owns its timers, browser visibility/
online listeners and in-flight AbortController. Route render and pagehide dispose
that work before private DOM is replaced. Back/forward-cache restoration keeps the
existing full reload/session revalidation policy. Returning to detail creates a
new bounded run rather than reviving the old controller.

Hidden documents and offline browsers pause checks and abort the current cycle.
Visibility and connectivity must both permit a read before scheduling resumes.
Paused time still consumes the original two-minute budget. The timer can be
throttled by the browser, so scheduling also compares the current wall clock with
the fixed deadline. Resuming after expiry cannot admit another read.

Stop, pause, expiry and disposal invalidate a generation as well as aborting its
signal. Even a reader that ignores cancellation cannot finish an old generation
or overlap a new one: the next run waits for the old promise to settle. A page
version and signal check precede applying fresh command/receipt data. An unresolved
reader cannot cause an unlimited stream of parallel requests.

The HTTP helper joins the page-read signal and the controller's cycle signal,
removes both listeners on settlement, and checks cancellation before processing
response status or data. An aborted old read cannot clear a newly rendered account
through a late 401. Live admitted 401 responses still clear private UI and show
sign-in; a changed-viewer response preserves the valid other-account cookie.
Reads already admitted by the server retain their ordinary authorization timing.
There is no cross-tab push revocation or claim that previously viewed data can be
retracted outside this page lifetime.
