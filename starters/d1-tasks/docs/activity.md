# Task activity

Created/updated/deleted entries commit with each task change. Unique mutation
tokens prevent stale updates adding phantom activity. Failure rolls back both
effects. GET /activity and /tasks/:id/activity expose metadata without title/
private mutation tokens. History survives task deletion. This public application
history is not an authenticated audit trail. See [tasks](tasks.md),
[pages](pagination.md) and [schema](schema.md).
