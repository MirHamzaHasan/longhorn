# Search command IDs

Owner: src/command-history.ts, history-search-migrations.ts and console/history-search.ts,
routes.ts, app.ts. Connects [history](history.md), [filters](history-filters.md),
[saved views](history-view-links.md), [export](history-export.md) and [schema](schema.md).

GET /account/commands accepts optional q: 4–36 characters from the start of a UUID,
with separators in UUID positions. Up to 128 raw characters are trimmed and folded
to lowercase; blank clears search. Wildcards, substrings, numbers, request keys
and payload search are unsupported. SQL binds lower(id) LIKE prefix%, retaining
actual stored IDs and the same principal-derived owner/operator rules.

The form submits explicitly and gives inline validation. Clear search retains
scope/status; scope/status changes retain q. Saved links include the entered
prefix in the address/history/bookmarks, and reload/Back/sign-in preserve it.
Payload, credentials, owner and pagination/export cursor fields remain excluded.

Unsearched v1/v2 cursors stay compatible. Search uses strict v3 bound to viewer,
scope, queue, status, normalized q and decimal int64 position. Changing search
requires a fresh page. Search export pages carry q and emit NDJSON v2 with
selection={scope,state,q}; ordinary exports remain v1. All existing bounds and
no-failed-attempt-download behavior remain in force.

Deploy the complete owner profile before updated hosts. Its appended
postgres_account_operations/004_history_search creates global and owner/lower-ID
text_pattern_ops indexes. Regular transactional builds block writes; budget the
maintenance window and storage. Startup/readiness require valid/ready indexes on
the expected table. Existing runtime grants suffice; no runtime DDL/repair is added.
Pagination bounds returned rows rather than all database work, and live-list
membership/late-commit limits remain unchanged.
