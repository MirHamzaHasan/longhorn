# Typed task observations

src/task-events.ts defines created/updated/deleted symbols and an application-owned
EventBus. Scoped observers update /activity counters with event/request/task IDs.
TasksService awaits them after SQL commit. Observer failure logs delivery metadata
without undoing a successful write. Scope/bus cleanup drains accepted work before
cache/database close.

Activity is process-local, resets on restart and sees only that host's writes.
It is not persistent history, a durable outbox or an authenticated audit trail.
See [tasks](tasks.md), [lifecycle](lifecycle.md) and [testing](testing.md).
