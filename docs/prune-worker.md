# Owned periodic pruning

Owner: optional `@longhornjs/runtime/prune-worker`. Connects the existing application
[lifecycle](lifecycle.md), [request-ledger cleanup](idempotency-cleanup.md) and
[request-budget cleanup](rate-limit-cleanup.md). The runtime root export stays unchanged.

`PruneWorker` borrows a target with `prune(limit: number): Promise<number>`. It adds
scheduling and ownership, not deletion policy. Construction/import does no work.
`start()` admits the first batch on a microtask, then waits `intervalMs` after each
settled call and its error observer. Even full batches wait; there is no overlap,
catch-up loop or recursive backlog drain. One instance can start once.

Options default to `limit=100`, `intervalMs=60000`; integer bounds are 1..10000 and
1..2147483647 respectively. Supplied values and onError are validated before work.
The target must return a safe integer between zero and the batch limit. An invalid
result follows the operational-error path. Targets retain their own clock/expiry
and authorization semantics.

`snapshot()` returns a detached aggregate: state (idle/running/closing/closed),
active, runs, removed, errors and observerErrors. Runs count admitted calls; active
includes awaited error observation. These are in-memory owner observations, not
backlog size, durable audit or provider health. They include no keys/error text.

`close()` is idempotent, stops admission, cancels an idle wait and drains the active
call/observer. A provider failure increments errors and permits another delayed
run. A failed observer increments observerErrors; close rejects its first thrown
value after draining, including when that value is undefined. Do not await close
from a callback that close is waiting for. No forced timeout claims unfinished
native work has stopped.

Both domain cleanup classes use this one owner. IdempotencyCleanup retains its
existing constructor/options/snapshot exports and validation text. No schema,
clock, pruning query or resource acquisition changes as part of that delegation.
See [native and packed proof](rate-limit-cleanup-testing.md).
