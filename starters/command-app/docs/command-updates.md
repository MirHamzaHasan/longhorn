# Follow command delivery and receipt

Owner: console/command-follow.ts and commandPage in console/app.ts. Connects
[commands](commands.md), [receipts](receipts.md), [console](console.md),
[recovery](recovery.md) and [viewer consistency](viewer-binding.md).

Pending/running/delivered command detail automatically checks for a receipt when
none exists. Each cycle uses the existing protected detail then receipt GETs, with
the normal cookie principal and displayed-viewer claim. A receipt 404 remains
pending. A real receipt, failed delivery or missing metadata stops checking; a
network/service error stops with a retry control. No command or recovery POST is
automatically submitted. A failed/unavailable initial view offers Follow updates
for an explicit check, including after operator recovery.

There is one cycle at a time, three seconds between settled cycles, at most thirty
cycles and at most two minutes per run. Existing per-request deadlines still apply.
Pause updates stops reads; Resume updates, Try updates or Check again starts a new
explicit budget. Refresh status remains available. This is polling, not live push
or a promise that delivery finishes before the limit.

Hidden/offline browsers pause and abort current reads; paused time still counts.
Navigation/pagehide disposes timers and listeners, and canceled old responses
cannot enter the next page. Updates replace data regions without moving focus.
A polite status region reports changes; completed controls stay present and marked
aria-disabled. Nothing new is stored in browser storage. History/operator lists
and recovery forms keep manual refresh, and no schema/grant change is needed.
