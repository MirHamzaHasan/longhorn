# Run a saved command again

Owner: console/app.ts and console/numbers.ts, using existing command APIs. Open
any admitted saved command and choose Run again. The review route is
`#/new/COMMAND_UUID`; it reads the source and pre-fills Numbers. Reloading reads it
again. Review/edit the values, then choose Create command. Opening the review never
submits. The source link goes back to the original command.

Only actual numeric arrays satisfying current 1–100 finite values / ±1 trillion
limits are copied. Malformed/unsupported legacy JSON is not coerced or truncated;
the screen offers a blank command form. Missing or unauthorized sources share one
unavailable state, and malformed UUID links do not select API paths.

Every review creates a fresh request key. Submission sends only `{id,numbers}` and
creates a separate command/delivery owned by the submitting account. An operator
may copy an admitted other-account source, but ownership is never transferred or
selected by that source. Original numbers, delivery, receipt and recovery history
stay unchanged. Copying adds no persisted parent/lineage relationship.

After a lost submission response, Try again reuses the same key while normalized
numbers stay unchanged in that form. Edited normalized values get a new key. Leaving
or reloading loses the key; check history before starting another copy after an
uncertain response. Already accepted work is not canceled by navigation. Operator
Retry delivery instead recovers the existing delivery with its allowance/audit.

Source reads are canceled on navigation and cannot restore an old screen. The
[viewer check](viewer-binding.md) also prevents an old account's form from submitting
under another tab's switched cookie. Numbers, request keys and credentials never
enter browser storage or URLs. Only the source UUID is in the hash link.

The repository gate verifies distinct actual receipts, edited/manual replay, scope,
loading, malformed legacy data and account switching. The independently installed
archive copies a pre-backup command after actual restore/regrant/restart, reloads
its review and creates a real new receipt. See [console](console.md),
[commands](commands.md), [history](history.md), [recovery](recovery.md) and
[feature connections](features.md).
