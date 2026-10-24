# Dependency injection

src/app.ts registers typed TaskDatabase, TaskRequests and Tasks tokens. Startup
verifies the borrowed database before registration. TaskRequests borrows it;
Tasks receives both providers. Routes resolve the repository instead of issuing
native binding calls. Services stay application singletons. See [lifecycle](lifecycle.md),
[database](database.md), [tasks](tasks.md) and [request replay](idempotency.md).
