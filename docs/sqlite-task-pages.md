# Bounded SQLite task cursor pages

Owner: examples/basic task query schema, service/store contract and SQL repository.
The same source runs in the [Node example](tasks-example.md), [Bun host](bun-sqlite-tasks.md),
Redis cache profile and independent Node/Bun SQLite starters.

GET /tasks now returns `{ tasks, nextCursor }`. It defaults to 20 rows and accepts:

| Parameter | Meaning |
| --- | --- |
| limit | Canonical decimal 1–100; default 20 |
| after | Positive canonical decimal int64 ID, at most 9223372036854775807 |
| completed | Optional literal true/false equality filter |

```sh
curl 'http://127.0.0.1:3000/tasks?limit=20&completed=false'
curl 'http://127.0.0.1:3000/tasks?limit=20&completed=false&after=9'
```

Unknown/duplicate parameters, empty or noncanonical numbers, invalid booleans and
out-of-range cursors return 400. Missing after starts at the beginning. IDs and
cursors remain strings through HTTP, preserving values above Number.MAX_SAFE_INTEGER.
Responses carry Cache-Control: no-store; application task pages are uncached.

TasksStore.list receives a typed limit/cursor/filter and returns TaskPage. The SQL
repository snapshots those values, binds every argument and fetches limit + 1
rows in ascending tasks.id order. It returns at most limit rows; another observed
row makes nextCursor the last returned ID, otherwise null. The lookahead stays
within Bun's native row limit. No OFFSET, caller-provided SQL identifiers or
client-side full-collection slicing is used. The appended
[completed/id index](sqlite-task-read-upgrades.md) supports filtered range scans.

The cursor is an ID boundary, not a retained row reference. Deleting its row does
not break the next page. SQL numeric ordering preserves 9 before 10 and exact
int64 positions. Pages observe live storage, not one snapshot across HTTP requests:
later inserts may appear, deleted rows vanish and changed completion/filter
membership can change traversal. Keep the same filter between pages. Cursors are
not authorization tokens; this example remains public.

This changes the former complete-list HTTP response. Clients must follow
nextCursor until null to enumerate all tasks, and use [aggregate summaries](sqlite-task-counts.md)
for whole-collection totals. Custom application stores must implement the new
list(query) and counts() contract. Framework Database/HTTP APIs do not change.
See [retained upgrades and native proof](sqlite-task-read-upgrades.md).
