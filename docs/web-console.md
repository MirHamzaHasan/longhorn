# Browser command console

Owner: `examples/postgres/console/app.ts`, `app.css` and `src/console.ts`.
Connects the existing [accounts](postgres-accounts.md), [history](account-command-history.md),
[commands](account-operations.md), receipts and operator APIs through real browser requests.

Run `pnpm demo:operator-accounts`, then open http://127.0.0.1:3010/console.
Create an account, enter numbers such as `4, 8, 15`, open the saved command and
follow its status until the computed receipt arrives. Commands lists owned history;
operators can explicitly select all commands. Load older uses the bounded server
cursor; Refresh starts at the newest page. Open a saved command and choose
[Run again](command-rerun.md) to review its numbers and create a separate command. Times use the browser locale.

The same built assets are included in `pnpm dev:operator-host` at `/console`.
That host retains data in separately provisioned PostgreSQL and receipt storage;
the demo removes its temporary state on exit. Account opens the [password settings](console-account.md), including sign-in after
a successful change and honest guidance after an unconfirmed response.
[Sign-in controls](console-session-controls.md) can end other sessions while keeping
this browser, or sign out everywhere.
No schema or role administration
is exposed through the browser. The API root remains at `/`.

Hash navigation keeps all browser routes under `/console`. Route changes cancel
old reads and prevent old responses replacing the new screen. API calls have a
15-second browser deadline. [Command detail updates](command-live-updates.md)
use bounded reads with pause/resume and automatic terminal stop. Refresh status
remains available; this is not live push. A missing receipt and unavailable
transport have distinct messages. Unknown legacy delivery metadata stays unknown.

See [browser security](console-security.md), [recovery](console-recovery.md),
[design rules](console-design.md) and [browser verification](console-testing.md).

## Retrying a command submission

The form keeps a random request key while the normalized numbers are unchanged.
After a network failure or timeout, Try again submits that same key and numbers.
If the first request committed, the server replays its original command/delivery
IDs. Changing the numbers creates a new request key. Keys are kept in this page's
memory only: reloading or leaving the form does not preserve a pending submission.
Check command history after reloading an ambiguous submission. The existing
[idempotency policy](idempotency.md) still bounds replay guarantees.

[Delivery status selectors](console-history-filters.md) filter Commands within the
current scope, restart pagination on selection and keep canceled older pages from
announcing stale errors. Show all clears only status; membership is live.

[Export history](console-history-export.md) downloads IDs, dates and delivery status
for the entire selected traversal, independently of loaded list rows. Large results
use explicit continuation files; cancel/navigation/errors discard the current file.

[Saved history views](history-view-links.md) put scope/status in the fragment.
Bookmarks, reload and Back/Forward restore the selected first page. Cold links and
expired sessions return through validated sign-in; server admission still governs
which rows appear. Loaded pages and export continuation are not part of the URL.

[Command-ID search](console-history-search.md) accepts an explicitly submitted UUID
prefix and combines it with scope/status. Its entered prefix is part of the saved
view link; paging uses v3 context and searched downloads identify q with v2 headers.

[Computed receipt downloads](console-receipt-export.md) use the current history
selection or one command detail, with explicit missing observations and the same
page-owned cancellation/focus policy as metadata downloads.

[Personal named history views](console-saved-views.md) add server-persisted presets
under a native disclosure. They reopen existing canonical filters without storing
commands or retaining old operator access.
