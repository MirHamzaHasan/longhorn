# Task service

GET/POST /tasks list/create tasks; GET/PATCH/DELETE /tasks/:id read, set completed
or delete. Creation returns 201/Location, deletion 204, and missing tasks 404.
IDs are nonreused decimal strings. List is a complete unbounded collection in
this example; add pagination for larger datasets.

Writes commit before summary invalidation and event observation. Updates have
ordinary last-writer semantics, without revisions. Request-key replay and private
account ownership are not enabled; retrying a lost create response can duplicate
work. See [validation](validation.md), [events](events.md) and [cache](cache.md).
