# Browser command history filters

Owner: examples/postgres/console/app.ts and app.css. Connects [console](web-console.md),
[API states](history-status-filters.md), [cursors](history-filter-cursors.md),
[viewer consistency](console-viewer-binding.md) and [proof](history-filter-testing.md).

Commands offers Delivery status with All deliveries, Pending, Sending, Delivered,
Failed and Unavailable. Operators retain their separate Show commands scope
selector; status filtering never changes scope or account policy. Both selectors
remain available for an empty result. No matching commands offers Show all, which
resets only the delivery filter and retains the chosen scope.

Changing status or scope starts a new first-page request. Load older uses the
scope and status captured for the page that supplied its cursor. Navigation aborts
ordinary reads, and late or aborted continuation results cannot replace the new
page or announce an error there. The existing displayed-viewer header continues
to fence stale cookie-switched views before private handlers.

Selection lives only in browser memory and resets on a full reload. Detail and
Run again navigation reuse the current list selection when returning to Commands;
there is no new URL query protocol, persistence key or background poll. Refresh
re-evaluates live membership, so delivered/retried/pruned jobs can leave a filter.

The controls use native labelled selects and the established kit. They stack at
phone widths, including 130% text, with light/dark captures and no horizontal
overflow. Accessible state text accompanies color. Native Chromium/axe proof
does not replace physical-device screen-reader and other-engine manual checks.
