# Saved history-view HTTP

Owner: configureHistoryViews in src/history-views-http.ts. Installed by account
operations using PgHistoryViews and an Idempotency provider over the same database.
Connects [values](saved-view-values.md), [transactions](saved-view-concurrency.md),
[viewer binding](console-viewer-binding.md) and [UI](console-saved-views.md).

All paths are under /account/history-views, require an authenticated account, and
retain no-store/Vary: Cookie and optional displayed-viewer checks. Writes require
the configured exact Origin and JSON through the existing account middleware.
Bodies/queries are strict; no owner or actor claim is accepted.

| Method/path | Request | Successful response |
| --- | --- | --- |
| GET / | No query parameters | 200 {views:[record]}, at most 20 sorted by name/id |
| GET /:id | UUID path | 200 {view:record} or owner-scoped 404 |
| POST / | {id,name,selection} | 201 {view:record}, Location and Idempotency-Replayed |
| PUT /:id | {requestId,expectedRevision,name,selection} | 200 {view:record}, Idempotency-Replayed |
| DELETE /:id | {requestId,expectedRevision} | 204, Idempotency-Replayed |

record is {id,name,selection,revision,createdAt,updatedAt}. Timestamps are server
epoch milliseconds. Revisions are positive safe integers. Creation starts at 1;
an accepted change increments it. A no-op update with the current revision keeps
the record unchanged. A stale update/delete returns 409 and requires refresh.
Missing/other-owner records return 404, including to operators.

The create ID is its stable replay key. Updates/deletes use a fresh requestId for
each intent. Keys are UUIDs, normalized to lowercase, and scoped by authenticated
account, action and resource. Repeating the same normalized input replays the
original response; reusing a committed key with different input returns 409.
Failed transactions record no completed result. Replays may describe an older
revision or a subsequently deleted record and never resurrect it; GET/list is the
current authority. Cached replay retains ordinary request admission; transaction
reauthentication applies to executing a fresh business intent. Replay eligibility defaults to the existing 24-hour window. Expiry is logical;
physical rows require the existing prune operation or key reuse.

Duplicate normalized names and a full collection return 409. Saving an all-scope
selection requires operator admission and a fresh in-transaction role check.
Read/list/delete of an owner's old all-scope preference remains allowed after
withdrawal. Opening its actual command view still reaches the existing history
authorization. A 401 follows normal account/session clearing behavior.
