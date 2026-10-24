# Task service

GET/POST /tasks list/create tasks; GET/PATCH/DELETE /tasks/:id read, set completed
or delete. Creation returns 201/Location, deletion 204, and missing tasks 404.
IDs are nonreused decimal strings. List returns {tasks,nextCursor}, defaults to
20 rows and accepts limit (1–100), after and completed filters. Follow the cursor
for later pages; see [pagination](pagination.md) and [task counts](task-counts.md).

Writes commit before summary invalidation and event observation. Updates have
ordinary last-writer semantics, without revisions. Request-key replay and private
account ownership are not enabled; retrying a lost create response can duplicate
work. See [validation](validation.md), [events](events.md) and [cache](cache.md).
