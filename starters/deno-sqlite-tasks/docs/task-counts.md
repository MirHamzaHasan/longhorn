# Aggregate task counts

TasksStore.counts returns whole-collection total/completed/pending counts. The
SQLite repository uses one count(*)/coalesce(sum(completed),0) statement, checks
safe nonnegative integers and derives pending. One result row avoids materializing
all tasks or hitting Deno's native result-row cap. The aggregate still scans entries;
no constant-time query claim is made.

TasksService adds generatedAt and uses the existing summary cache. TTL, shared
loads, local write invalidation, source errors and cache-failure bypass remain
unchanged. Counts are independent of page filters. Another host's writes follow
TTL rather than distributed invalidation. See [cache](cache.md),
[pagination](pagination.md), [upgrades](upgrades.md) and [testing](testing.md).
