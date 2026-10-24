# Derived summary cache

src/task-cache.ts owns a bounded memory store and Cache through DI. /summary
shares concurrent loads, reuses values within CACHE_TTL_MS and invalidates on local
task changes. Cache failures bypass derived values while SQLite keeps authority.
Normal task reads stay uncached. Cache and loader generation fences are process-local;
another host's write may stay absent from a summary until TTL expires. This
starter opens no Redis service. See [configuration](configuration.md),
[tasks](tasks.md) and [events](events.md).

Summary loaders use one SQL aggregate row through TasksStore.counts, independently
of cursor pages. See [task counts](task-counts.md).
