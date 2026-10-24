# History selection and browser navigation

Owner: openHistoryView, commandsPage and the history navigation links in app.ts.
Connects [URL grammar](history-view-links.md), [history paging](command-history-cursors.md),
[export](console-history-export.md) and [proof](history-view-link-testing.md).

Changing scope, status or submitted ID prefix pushes a canonical fragment and immediately renders the
new first page. Show all clears status and retains scope. Browser Back and Forward
restore the selected URL and re-read the first page under current authorization;
they do not restore cached private DOM or a database snapshot. Refresh reuses the
same URL without adding a browser-history entry. Reload reconstructs the selectors
from the fragment rather than a remembered JavaScript variable.

Within the current document, Commands navigation and the detail Back to commands
link retain the latest valid history selection. Reuse and creation navigation keep
that return view as well. A directly opened/reloaded detail URL has no parent
selection encoded, so its in-app return link uses the default until another list
view is visited. Browser Back can still return to the preceding saved list URL.
The brand's default command link opens the ordinary own/all-state view.

Selection changes enter the existing render lifetime: abort ordinary reads,
dispose command-follow/export work, clear secret controls and fence late results.
Load older keeps its captured scope/status/cursor until navigation. An older-page
completion cannot append to a new view or announce an aborted-read error there.
Export starts from the selected first page and keeps its existing bounded segment
rules; export continuation is reset when the route is re-created.

The controls and kit remain unchanged. Invalid history links have a static heading
and an action to the last valid view. A forbidden operator view offers an explicit
own-scope link with the same status and ID prefix. Native labels, target sizes, light/dark contrast,
focus-on-navigation and reduced-motion behavior remain in force.
