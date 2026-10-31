# Live command history updates

See the [development handoff](development-handoff.md) for the last verification.

Owners: [history list](../examples/postgres/console/history-list.ts) and
[window collector](../examples/postgres/console/history-live.ts). Connects the existing
[history API](account-command-history.md), [delivery filters](history-status-filters.md),
[search](history-id-search.md), [lifecycle](history-update-lifecycle.md),
[controls](console-history-updates.md) and [proof](history-update-testing.md).

An admitted Commands page starts a bounded run of reads, including an empty view.
New commands from another client can appear, delivery/attempt fields update, and
commands enter or leave the selected live status filter. Scope, status and search
stay captured for that page. Named-view edits, unsubmitted search input, export
choice/progress and links retain their own state.

Each cycle re-reads the complete loaded window from the newest matching command,
using the existing protected GET /account/commands with the same cookie/viewer
policy. Twenty rows form one manual page. Up to ten loaded pages (200 rows) refresh
in at most two serial reads of at most 100 rows. The collector publishes one complete
public metadata result after every read succeeds; failures/cancellation never
publish a partial window. It checks duplicate IDs, cursor bounds/loops, page shape
and the existing metadata projection, and never infers history position from dates
or IDs. Legacy null dates/delivery references remain valid.

A refresh retains the selected window capacity, not a frozen set of commands.
Newer matches can displace the oldest visible rows; Load older continues from the
fresh last cursor. Filter changes during traversal are live observations. Separate
SQL pages are not a snapshot or a total/completeness promise. Existing server
keysets, ownership and authorization remain authoritative.

After ten older-page loads, automatic checks stop while all manually loaded rows
remain available. Explicit paging still works; Refresh list restarts at the newest
20 commands. This separates bounded live monitoring from deliberate deep browsing.
[Timing and cancellation](history-update-lifecycle.md) also bound every run.

The feature adds browser GETs only: no new endpoint, schema, grant, server timer,
command submission, delivery retry or receipt read. [Command detail following](command-live-updates.md)
retains its separate receipt behavior. Private rows/cursors never enter browser
storage or saved links.
