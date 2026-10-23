# Command history

Owner: src/command-history.ts and command-history-migrations.ts. Immutable int64
positions support bounded owner-scoped seek pages. Members see their own commands;
operators explicitly select all. The cursor records principal/scope/queue context
but does not replace server authorization. Refresh starts a new live traversal;
pages are not a database snapshot.

Only safe outgoing metadata is joined. Missing/pruned delivery metadata remains
unavailable; retained identity does not mean delivery succeeded. Legacy migration
retains every command and backfills only unambiguous outgoing associations.
Connects [schema](schema.md), [commands](commands.md) and [receipts](receipts.md).
