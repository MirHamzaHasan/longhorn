# Budget cleanup admission and shutdown

Owners: RateLimitCleanup and [PruneWorker](prune-worker.md). Connects the existing
[limiter drain](rate-limit-lifecycle.md), [application lifecycle](lifecycle.md),
[example wiring](rate-limit-cleanup-example.md) and [native proof](rate-limit-cleanup-testing.md).

The owner goes idle -> running -> closing -> closed. Starting twice or after close
fails. Closing before start is valid. If close wins before the first microtask,
no prune starts. Loop ownership is registered before a custom pruner can
synchronously request close, so reentrant close still waits for actual settlement.

At most one prune is active per owner. Waiting starts after settlement, not at a
fixed wall-clock cadence. A slow query never overlaps a later tick. close changes
admission state first, wakes an idle wait and awaits an admitted prune and optional
async error observer. Native SQL has no cancellation facade here; a blocked write
or table lock must settle before resource release.

Operational errors remain observable to the awaited onError callback and aggregate
snapshot. They do not themselves reject close. Observer failure is retained and
reported by close after the owner reaches closed. A callback must settle, and must
not await the same cleanup/limiter/app close that is draining it.

Acquire database -> limiter -> cleanup. Longhorn drains HTTP then releases resources
in reverse order. The example also verifies startup rollback after cleanup starts;
cleanup reaches closed before database close. Do not close the borrowed limiter
first: subsequent prune calls would fail with CLOSED until cleanup is stopped.

Each host owns its own interval. There is no cluster-wide singleton, distributed
lease, automatic restart or hard cancellation promise. Provider contention and
lock-skipping retain their existing behavior. See [retention and authority](rate-limit-cleanup-retention.md).
