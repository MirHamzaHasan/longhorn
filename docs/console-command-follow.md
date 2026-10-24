# Browser receipt following

Owner: commandPage in examples/postgres/console/app.ts and the follow-updates CSS.
Connects [update policy](command-live-updates.md), [lifetime](command-follow-lifecycle.md),
[console kit](console-design.md) and [verification](command-follow-testing.md).

An unfinished active command shows its delivery and receipt with a short update
message and Pause updates. Pause stops reads; Resume updates starts a new bounded
run. Failed or unavailable metadata and an initial receipt-service outage offer
Follow updates without automatically starting. An error offers Try updates; the
run limit offers Check again. Refresh status remains available throughout.

Fresh delivery facts and computed receipt values replace only their data regions.
The page, numbers, navigation and controls keep their DOM identity; updates do not
rerender the route or move keyboard focus. Completion retains the focused control
as Updates finished with aria-disabled=true. It performs no further action.
The final receipt/failure/unavailable message remains visible until navigation.

A local polite, atomic status region announces run state changes rather than every
unchanged poll. Delivery words accompany color. The controls use the existing
system font, contrast tokens, focus treatment and button targets, wrap on narrow
screens and support 130% text in both themes. No animation or countdown is needed.

Hidden/offline status explains why reads pause. Service/network failure stops
checking and preserves the last admitted data; it does not label an unknown
delivery as failed. Session expiry or a switched-account 401 uses the existing
sign-in flow and removes private content. No follow preference or command data is
stored in localStorage or sessionStorage.
