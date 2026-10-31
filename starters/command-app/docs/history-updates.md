# Live command history

Commands automatically checks its selected scope/status/ID search for two minutes.
Pause list updates stops checks; Resume/Check again starts a fresh bounded run.
New commands and delivery changes appear without rebuilding searches, saved-view
edits or export controls. A focused surviving command stays focused; one that
leaves the view returns focus to the update control.

The existing protected GET /account/commands supplies public metadata. Twenty rows
form a manual page; up to 200 loaded rows refresh completely in at most two serial
reads. Every cycle publishes only after all its pages succeed. New matches may push
older ones beyond the window. Pages are live, without a snapshot or total promise.
Load older continues from the refreshed cursor. Deeper manual browsing pauses
automatic updates and keeps its rows until explicit Refresh list.

Connects [history/search](features.md), [lifecycle](history-update-lifecycle.md),
[setup](setup.md), [development](development.md) and [backup](backup.md).
Source: console/history-list.ts, history-live.ts and their tests. No server endpoint,
schema, grant, receiver policy or command mutation changes are required.
