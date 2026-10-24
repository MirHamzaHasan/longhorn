# Dependency injection

src/app.ts registers settings and the task service. Startup configures TaskDatabase
and TasksStoreToken, while event/cache providers are application-owned singletons.
TasksService receives the abstract TasksStore, EventBus, logger and summary cache;
handlers resolve it from the application container. Native driver calls stay in
storage/repository files. See [lifecycle](lifecycle.md), [tasks](tasks.md),
[events](events.md) and [cache](cache.md).
