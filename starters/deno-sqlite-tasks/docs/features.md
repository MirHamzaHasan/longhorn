# Feature connections

The Deno host validates settings and starts an application. DI connects the
SQLite repository to the task service; events/cache remain separate observations.

| Feature | Guide | Connects to |
| --- | --- | --- |
| HTTP | [HTTP](http.md) | Hono, request IDs and JSON routes |
| Validation | [Validation](validation.md) | Standard Schema, title/completion inputs |
| Configuration | [Configuration](configuration.md) | Environment files, process precedence and native settings |
| DI | [Dependency injection](dependency-injection.md) | Settings, database, repository, task service, events/cache |
| Lifecycle | [Lifecycle](lifecycle.md) | Resource acquisition, HTTP/observer/cache drain and DB close |
| Logging | [Logging](logging.md) | Structured levels, correlation and request/error records |
| Persistence | [SQLite](sqlite.md) | Native file database, exact IDs and SQL parameters |
| Schema | [Migrations](migrations.md) | Immutable checksummed history and transactional startup |
| Tasks | [Tasks](tasks.md) | CRUD and committed writes |
| Events/activity | [Events](events.md) | Typed awaited process-local observations |
| Summary cache | [Cache](cache.md) | LRU/TTL loads, invalidation and direct source fallback |
| Runtime/development | [Runtime](runtime.md) | Native Deno listener, owned build/reload and native signals |
| Verification | [Testing](testing.md) | Source tests, real HTTP, process restart/concurrency/integrity |
| Task cursor pages | [Pagination](pagination.md) | Bounded SQL lookahead, exact IDs and live filters |
| Whole-collection counts | [Task counts](task-counts.md) | Aggregate reads and existing summary cache |
| Retained read upgrade | [Upgrades](upgrades.md) | Original checksum, appended index and native large-data proof |
| Runtime permissions | [Permissions](permissions.md) | Validated grants, literal data paths, per-launch cleanup and native denial probe |
