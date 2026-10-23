# Redis-backed task summaries

Owner: `examples/basic/src/redis-index.ts`, redis-config.ts and redis-cache.ts.
Connects the existing [tasks service](tasks-example.md), [cache](cache.md),
[Redis store](redis-cache.md), [JSON codec](cache-json-codec.md) and
[native connection](redis-node.md). The [native HTTP gate](redis-cache-testing.md)
checks this compiled profile with actual SQLite and Redis processes.

```sh
pnpm dev:redis-cache
```

Supply REDIS_URL in the environment or copy examples/basic/.redis.env.example
to examples/basic/.redis.env and replace its connection/password. Provide an
existing Redis 7+ standalone server; this command owns only the application.
The profile reads only
.redis.env and .redis.env.local; environment values win. It defaults to loopback
port 3013 and data/redis-tasks.sqlite. The normal `pnpm dev` memory-cache profile
keeps its existing configuration and behavior.

| Setting | Policy/default |
| --- | --- |
| REDIS_URL | Required explicit rediss URL; no query/fragment or nonnumeric DB path |
| REDIS_NAMESPACE | tasks; 1–64 ASCII letters/digits/underscore/hyphen |
| REDIS_ALLOW_INSECURE_LOOPBACK | false; explicit true permits loopback redis only |
| REDIS_TLS_CA | Optional private PEM trust for rediss; verification remains enabled |
| REDIS_CONNECT_TIMEOUT_MS | 5000; 1–60000 |
| REDIS_COMMAND_TIMEOUT_MS | 2000; 1–60000 |
| CACHE_TTL_MS | 5000; existing 0–3600000 range |
| DATABASE_PATH | ./data/redis-tasks.sqlite; explicit :memory: remains available |

GET /summary caches only derived public counts and a generation timestamp. Task
CRUD/list/detail always use SQLite. A strict schema validates counts, their
relationship and the ISO timestamp before a Redis result becomes a TaskSummary.
No authentication/session result or task title is cached.

The DI factory consumes TaskSummaryStore plus AppSettings. Storage startup acquires
SQLite first, then the chosen store, then event observers; cleanup reverses those
owners. The selected store is registered once, following the container's duplicate
provider rule. Startup validates configuration before acquisition, rejects a failed
Redis connection before HTTP listens, and signals close admission while acquisition
settles. The profile does not start/stop a user's Redis service.

Committed task writes invalidate the shared summary key. If cache access or
invalidation fails, the existing service logs safe operation metadata, disables
that cache for the process and reads authoritative source data. A cache outage
never changes a committed business result into a failed HTTP write. Redis recovery
does not silently reconnect or re-enable that process's bypassed cache.

Other hosts' loaders are not fenced by one coordinator. Cached counts can lag
external writes, including after a process restarts following failed invalidation;
TTL or deliberate trusted invalidation bounds/corrects retained entries. An older
foreign load can repopulate after another host's delete. Use task reads for authority
and do not treat this view as a transactionally consistent cross-process snapshot.
