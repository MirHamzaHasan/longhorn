# Feature connections

The host supplies a DB binding to the Fetch application; DI owns repositories
and schema verification precedes requests. Each feature has its own guide.

| Feature | Guide | Connects to |
| --- | --- | --- |
| HTTP | [HTTP](http.md) | Hono, request IDs, JSON and body budgets |
| Validation | [Validation](validation.md) | Standard Schema, Zod, title/revision/cursor input |
| Configuration | [Configuration](configuration.md) | Host environment and typed Worker bindings |
| DI | [Dependency injection](dependency-injection.md) | TaskDatabase, TaskRequests and Tasks |
| Lifecycle | [Lifecycle](lifecycle.md) | Shared startup, read-only schema checks and close |
| Logging | [Logging](logging.md) | Request context and local host records |
| Database | [D1 database](database.md) | Native atomic batches, precision and retained storage |
| Schema | [Schema](schema.md) | Trusted private deployment and immutable history |
| Tasks | [Tasks](tasks.md) | UUIDs, conditional revision writes and activity |
| Activity | [Activity](activity.md) | Atomic retained task history |
| Pagination | [Pagination](pagination.md) | Qualified numeric ordering and exact text cursors |
| Request replay | [Idempotency](idempotency.md) | Saved responses, key scope, expiry and cleanup |
| Runtime | [Runtime](runtime.md) | Actual local workerd and cloud deployment boundary |
| Development | [Development](development.md) | Browser builds, source watch and owned host restart |
| Verification | [Testing](testing.md) | Source tests and actual temporary D1/restart |
