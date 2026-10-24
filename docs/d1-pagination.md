# Exact D1 cursor pages

Owner: page validation in [config.ts](../examples/d1-worker/src/config.ts) and
keyset queries in [tasks.ts](../examples/d1-worker/src/tasks.ts). Connects
[task lists](d1-tasks.md), [activity](d1-task-activity.md) and the
[provider's number policy](workers-d1.md).

Tasks and activity each have an INTEGER PRIMARY KEY AUTOINCREMENT position.
Queries compare `position > ?`, order by position and fetch limit plus one.
Responses contain tasks/activity and nextCursor, a decimal string when another
page exists or null at the end. The cursor is the last returned position, not
the lookahead row. Global and per-task activity use the same bounded protocol;
the latter has a (task_id,position) index.

`after` defaults to "0" and accepts canonical nonnegative decimal int64 through
"9223372036854775807". `limit` defaults to 20 and accepts 1–50. Invalid syntax
fails validation before BigInt conversion. The cursor stays a bound string;
SQLite column affinity performs the exact integer comparison. Selected positions
use CAST(position AS TEXT), so the D1 JavaScript number bridge never rounds them.
Task IDs remain UUIDs, independently of internal positions.

```text
GET /tasks?limit=1&after=9007199254740992
nextCursor: "9007199254740993"
GET /tasks?limit=1&after=9007199254740993
```

The native gate inserts actual positions beyond 2^53 and verifies successive task
and activity pages through two workers. Ordinary paging also checks no duplicates
across a retained dataset. Pages are live keyset reads, not a frozen multi-request
snapshot: later writes/deletions can change subsequent pages. Cursors are not
authorization tokens and do not contain user/tenant scope. See [tests](d1-testing.md).
