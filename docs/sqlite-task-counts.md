# SQLite aggregate task summaries

Owner: TasksStore.counts and SqliteTasksStore.counts in examples/basic. Connects
[paged task reads](sqlite-task-pages.md) to the existing
[summary cache](task-cache.md), Node/Bun/[Deno storage](deno-sqlite.md) and optional Redis cache profile.

GET /summary keeps its existing numeric total/completed/pending fields and ISO
generatedAt timestamp. Counts describe the whole task collection, independently
of a list page's cursor/filter. The service now calls counts(), not list(), so
a bounded page cannot masquerade as the collection total.

The SQLite store executes one aggregate statement:

```sql
SELECT count(*) AS total, coalesce(sum(completed), 0) AS completed FROM tasks
```

An empty collection has zero completed tasks. One database statement observes
both values together and materializes one row. Integers must decode as nonnegative
safe JavaScript counts, with completed no greater than total; inconsistent or
unsafe values reject instead of rounding. Pending is total minus completed.
generatedAt records computation completion. This avoids task-row/blob/title
materialization and Bun's 1000-row result boundary; the aggregate still scans
database entries and makes no constant-time performance claim.

Cache keys, value shape, TTL, shared loads, generation fences, write invalidation
and source/provider failure policy remain the same. Local successful writes
invalidate after commit. Another host's writes can remain absent until TTL, and
the current in-flight observer may see its earlier snapshot. Summary computation
is not an atomic transaction spanning cache and HTTP. Source failures remain
errors; cache failures deliberately bypass derived values.

Native tests exercise counts across a 1029-task collection, filtered pages, live
deletion/insertion and restart on Node and Bun. Cache tests verify aggregate call
sharing, source failure, invalidation and old-load fencing without loading pages.
See [proof and migration history](sqlite-task-read-upgrades.md).
