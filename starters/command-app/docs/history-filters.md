# Delivery status filters

Owner: src/command-history.ts, history-filter-migrations.ts and console/app.ts.
Connects [history](history.md), [console](console.md), [schema](schema.md) and
[setup](setup.md). This feature uses the existing cookie principal, fixed command
queue, metadata projection and native PostgreSQL repository.

GET /account/commands accepts state=all (default), pending, running, succeeded,
failed or unavailable. Unavailable means no matching metadata in the command
queue, including legacy or pruned associations; it is never inferred success.
The browser labels running as Sending and succeeded as Delivered. Scope stays
mine unless a current numbers-operator explicitly selects all. Unknown/duplicate
queries fail; returned summaries contain no numbers, payload or lease token.

Changing either selector restarts pagination. Show all resets only status. Load
older keeps its page's scope/status, and canceled old pages cannot overwrite or
announce errors on a new filter. Selection is memory-only and resets on reload.
Membership is live: refresh after dispatch, recovery or pruning to see changes.

Unfiltered pages retain v1 cursors; filtered v2 cursors bind the exact status plus
viewer/scope/queue and decimal int64 position. Changing filter requires a fresh
page. These unsigned encodings grant no authority and hold no snapshot.

Deploy the complete owner migration profile before the updated host. The appended
postgres_account_operations/003_history_filters adds a partial command delivery/
owner/history index and fixed-queue job state/id index. Regular transactional
CREATE INDEX blocks writes during construction; use the stopped-writer maintenance
procedure. Startup/readiness require valid, ready indexes on their expected tables.
Existing runtime grants suffice; the HTTP account cannot deploy or repair them.
Pagination bounds returned rows rather than database work, especially when
metadata is unavailable. Source verification covers real migration interruption,
queue transitions, filtered cursors, grants, browser cancellation and restored apps.
