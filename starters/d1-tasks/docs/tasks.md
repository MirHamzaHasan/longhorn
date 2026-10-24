# Tasks

src/tasks.ts maps SQL rows into Task objects. GET/POST /tasks list/create UUID tasks;
GET/PATCH/DELETE /tasks/:id read/change/delete them. PATCH includes current revision
plus title and/or completed; DELETE includes current revision. Conditional SQL
increments revisions once, returning 409/currentRevision for stale changes.

Task changes and activity share a native batch. Optional creation request keys
save the original JSON response with those effects. The dataset is public; add
authenticated ownership before using private data. See [validation](validation.md),
[activity](activity.md), [pages](pagination.md) and [idempotency](idempotency.md).
