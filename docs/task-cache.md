# Cached task summaries

Owner: `examples/basic/src/task-cache.ts` and `TasksService.summary`. Connects
[typed caching](cache.md), [memory storage](memory-cache.md), configuration, DI,
committed writes, logging, and lifecycle. The existing task list/detail endpoints
continue to read their store directly.

```sh
pnpm dev
curl http://127.0.0.1:3000/summary
```

The response contains a summary with numeric `total`, `completed`, and `pending`
counts, plus an ISO `generatedAt` timestamp for computation completion. Repeated reads
within the local TTL reuse that snapshot. HTTP responses use `Cache-Control:
no-store`, so browser/proxy caching does not obscure the application's cache behavior.

## Connections and consistency

| Part | Owns | Connects to |
| --- | --- | --- |
| `CACHE_TTL_MS` | Validated startup setting | Defaults to 5000 ms; accepts 0–3600000 |
| `TaskSummaryStore` | DI token for `CacheStore<TaskSummary>` | Memory by default (16 entries); an optional resource factory selects Redis |
| `TaskSummaryCache` | DI token for `Cache<TaskSummary>` | Selected store plus validated TTL, one value schema |
| `TasksService.summary` | Cached derived read | Shared load from `TasksStore.list`, public counts/timestamp |
| Successful service mutations | Direct invalidation | Delete summary key before event observations/HTTP success |
| `configureTaskCache` | Lifetime | Acquire after database and before event ownership |
| `/summary` | HTTP view | Returns the derived snapshot; normal tasks remain uncached |

Zero TTL disables retained summaries while still allowing simultaneous misses to
share an in-flight computation. Local creates, updates, and deletes invalidate
directly after commit. Invalidation does not depend on an event listener that could
fail or be unsubscribed. Validation failures, missing records, and failed writes
leave the current cache untouched.

If a write races an older summary load, callers already waiting for that load may
receive its older snapshot. The generation fence prevents it from restoring stale
cache contents. Reads after successful local invalidation use a new generation.
This is not an atomic transaction spanning a source read, cache, and HTTP response.

Other processes' writes do not invalidate this process's memory. Their changes can
remain absent from `/summary` until expiry; `/tasks` and `/tasks/:id` retain their
uncached source behavior. The default memory profile has no cross-process
invalidation. The separate [Redis profile](redis-tasks-example.md) shares stored
summaries with explicit TTL and consistency limits. The generated timestamp makes the snapshot's computation time
visible, and the TTL defines the normal retention window.

## Failure and lifecycle policy

Cache-provider failure while reading causes this service instance to bypass the
cache and read its task store. Invalidation failure after a committed write does
the same, preserving successful write responses without trusting a retained entry.
The bypass lasts until a new service/application instance is created. Source-read
errors remain errors and are not mistaken for provider failures. A failed store write
never triggers an event or cache invalidation.

The cache coordinator itself is strict; this fallback is an explicit application
choice. Cache error logs contain operation metadata, not raw causes, keys, or task
titles. Computation logs contain public counts. A provider write failure after a
successful source load can cause one extra source read during fallback.

Startup acquisition is database, cache, then event subscribers. Cleanup drains HTTP,
then events, then accepted cache loaders, then closes the database. External cache
loads are included in that drain. The cache starts empty after restart; SQLite task
data remains durable. Explicit memory-store test apps use the same cache/event
lifetime without native storage.

## Verification and portable examples

The task cache suite checks source-call counts, expiry, direct write invalidation,
an older loader racing a successful write, provider-failure bypass, source errors,
and event/cache/database cleanup order. `pnpm test:cache` checks real TCP bursts,
two writer processes, the TTL boundary, uncached reads, and restart/shutdown.

Portable apps and generated starters demonstrate a separate public runtime profile
at `GET /cached`, with a five-second TTL and `POST /cached/invalidate`. Its value
contains only runtime and generated timestamp, never request-specific bindings,
credentials, or echo input. The root greeting and auth example are not cached.
Those profiles exercise the same cache package on all runtime targets.
