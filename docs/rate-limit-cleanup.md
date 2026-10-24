# Owned expired-budget cleanup

Owner: optional `@longhorn/ratelimit/cleanup`. Connects [RateLimiter](request-limits.md),
the shared [prune worker](prune-worker.md), [retention](rate-limit-cleanup-retention.md),
[lifecycle](rate-limit-cleanup-lifecycle.md), a [runnable app](rate-limit-cleanup-example.md)
and [verification](rate-limit-cleanup-testing.md).

```ts
import { RateLimitCleanup } from '@longhorn/ratelimit/cleanup'
const cleanup = new RateLimitCleanup(limiter, {
  limit: 100, intervalMs: 60_000,
  onError: async () => { logger.warn('Expired request limit cleanup failed') },
})
app.onStart(() => { cleanup.start(); return () => cleanup.close() })
// Acquire database and limiter before this hook so they close afterwards.
```

The cleanup borrows `limiter.prune`; it does not consume a subject or create another
clock/store. That API retains provider-native pruning semantics and validates the
returned count. Both application-clock and server-timed limiters are accepted.
Defaults/bounds, serial delayed runs, snapshots and observer failures follow
[PruneWorker](prune-worker.md). Cleanup construction creates no timer/SQL; start is
explicit. Each batch waits before the next, including after a full result or error.

Closing cleanup keeps the limiter/store/database open. Shut down HTTP, cleanup,
limiter, then database. There is no public reset endpoint, automatic refund, new
schema or default-on framework task. The SQLite example makes the option concrete;
the account command host's separate runtime authority remains unchanged. A
[dedicated maintenance process](command-limit-maintenance.md) now ships with that
application instead of borrowing its HTTP pool.

This timer owner is for native long-lived hosts. A finite workerd invocation proves
portable coordination, not a persistent edge timer service. Workers/D1/Object
owners should await bounded `limiter.prune(limit)` inside their existing scheduled
or alarm invocation when they deliberately add maintenance. This feature does not
install a maintenance alarm, cron trigger, cloud deployment or global leader.
