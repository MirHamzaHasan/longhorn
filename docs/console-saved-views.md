# Browser saved history views

Owner: savedViewsPanel in console/app.ts. Connects [personal views](saved-history-views.md),
[HTTP](saved-view-http.md), [canonical navigation](console-history-navigation.md),
[export](console-history-export.md) and [native proof](saved-view-testing.md).

Commands adds a native Saved views disclosure with the current personal count.
Inside, Saved view chooses a named record or Current filters. Choosing a name
opens its canonical scope/status/search URL through the existing navigation path.
Open view reapplies the selected record after unsaved filter changes or a refreshed
record. Names and selections persist on the server; the selected ID/open state
remain memory-only and are bound to the displayed account.

Current filters plus View name creates a view. A selected record offers Update
view for its name/current filters and Delete view for that preference. Refresh
views reloads current records and revisions. Deletion leaves the current filter
URL intact. Changing filters does not automatically save. Raw command contents,
list pages, export mode and continuation never enter the saved record.

Controls share one in-flight mutation guard. Unchanged retries retain a stable
request key after a lost response; changed input starts a new intent. A revision
conflict leaves input visible and asks for Refresh views. Navigation may leave a
committed server write, but route/subject guards prevent a late callback from
changing the next screen. Page cleanup clears private name/error text and composes
with existing export disposal. Cookie switches fail under displayed-viewer policy.

Failure to load optional preferences leaves command history usable, with a scoped
Refresh views action. Authentication failure retains the normal private-UI clearing
path. A former operator opening an all-scope preference gets actual denial and the
existing own-scope action. The preference itself remains manageable by its owner.

Labels, native disclosure/select semantics, focus rings and explicit validation
feedback use the current kit. Name errors link aria-invalid/aria-errormessage to
an alert and focus the field. Buttons/fields disable together during writes. Layout
wraps at phone widths and 130% text in both themes; no motion or persistence beyond
the existing theme preference is added to browser storage. Draft names do not
survive navigation or Refresh views.
