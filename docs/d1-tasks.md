# Persistent D1 tasks

Owner: [examples/d1-worker](../examples/d1-worker/README.md). Connects Workers Fetch,
typed config, Standard Schema validation, DI and lifecycle to the optional
[D1 batch provider](workers-d1.md). It is a public task API example; authentication,
per-user ownership and cloud deployment are separate integrations.

```sh
pnpm dev:d1
curl http://127.0.0.1:3016/health
curl http://127.0.0.1:3016/tasks -H 'Content-Type: application/json' -d '{"title":"Build on D1"}'
```

`index.ts` adapts the binding into a shared Longhorn app. `app.ts` acquires and
verifies TaskDatabase during startup, registers it in the container and owns its
cleanup. `Tasks -> TaskDatabase` resolves the repository. SQL and row mapping stay
in `tasks.ts`; HTTP handles validated requests/domain results, with no native D1
methods in route handlers. [Deployment](d1-deployment.md) applies schema separately.

| Method | Path | Result |
| --- | --- | --- |
| GET | /health | Successful schema/startup profile |
| GET | /tasks | Bounded task page |
| POST | /tasks | 201 task and Location |
| GET | /tasks/:id | Current task or 404 |
| PATCH | /tasks/:id | Updated task, 409 conflict or 404 |
| DELETE | /tasks/:id | 204, 409 conflict or 404 |
| GET | /activity | Bounded activity page |
| GET | /tasks/:id/activity | Activity, including after task deletion |

Titles are trimmed to 1–200 characters; IDs are server-generated UUIDs. Task JSON
contains id, title, completed, revision, createdAt and updatedAt. PATCH requires
the observed positive revision plus title and/or completed. DELETE requires JSON
`{"revision":1}` using the current value. Unknown body fields, malformed JSON,
invalid IDs and invalid page input return 400; bodies exceeding 16 KiB return 413.
Responses use no-store. Storage errors return a generic 503 without driver SQL or
arguments; unexpected errors return 500.

Conditional UPDATE/DELETE statements compare the revision inside the native
batch. An update increments it once; a stale request returns 409 with
currentRevision and makes no activity entry. Revisions stop at 2147483647;
an update at that ceiling conflicts, while deletion can still succeed. A private
mutation UUID links an update to its activity INSERT SELECT, avoiding phantom
events from a losing writer. [Activity](d1-task-activity.md) commits atomically
with changes; [pagination](d1-pagination.md) preserves exact integer cursors.

This is optimistic concurrency, not request idempotency. Retrying a lost create
reply can create another UUID; a committed update with a lost reply may later
conflict. Read current state before deciding how to recover. Native tests exercise
the real deployment helper, cross-worker edits, failed activity rollback, HTTP
validation and retained storage; see [proof](d1-testing.md).
