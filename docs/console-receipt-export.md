# Browser receipt downloads

Owner: receiptExportView, historyExportControls, fileExportControls and ownPageWork
in console/app.ts. Connects [receipt export](receipt-export.md), [command following](console-command-follow.md),
[history controls](console-history-export.md) and [native proof](receipt-export-testing.md).

Commands adds a labelled Export contents selector. Command history remains the
default; choosing Computed receipts changes the hint and action to Export receipts.
The current scope/status/search still comes from the history view. Selecting a
different export type cancels preparation, clears its in-memory continuation and
releases temporary URLs. The native selector keeps keyboard focus. A new page or
filter view starts with the default export choice.

Computed receipt detail also shows Export receipts for that one command, including
when its current receipt was not found. The click re-reads protected command detail
and receipts; it does not merely serialize previously displayed values. Receipt
arrival through live updates does not automatically initiate a download. The
export description explains that missing receipts are marked in the file.

Preparation reports accepted command counts. Success reports this file's command
count, which includes not-found observations. A bounded history file offers
Continue export and Start over. Start over begins at the newest matching commands
and returns focus to Export receipts. Cancel aborts without a current file. A
failed unchanged attempt can be explicitly retried from the same saved boundary.

Busy controls retain guarded aria-disabled behavior. Focused Cancel remains in
the DOM after settlement; local status is polite/atomic. The existing kit supplies
focus rings, targets, responsive layout and both themes, including 130% text. No
motion is added. The browser controls where the private aggregates are saved;
Export ready means initiation rather than confirmation of an OS save.

Page work registration composes disposal of live follow and download work. Export
choice generations additionally stop a canceled old collector from changing the
new choice's buttons, status or file. No export selection, data or continuation is
stored in localStorage or the URL; existing URL filters retain their own policy.
