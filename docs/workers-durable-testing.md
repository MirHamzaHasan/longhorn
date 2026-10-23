# Durable Worker native verification

Owner: [verify-worker-storage.mjs](../scripts/verify-worker-storage.mjs) and
[storage fixture](../scripts/fixtures/worker-storage.mjs). Connects
[provider](workers-durable-sqlite.md), [transaction ownership](durable-sqlite-transactions.md),
[queue claims](workers-durable-queues.md), [atomic schedules](workers-durable-scheduler.md)
and [the compiled report app](workers-durable-example.md).

```sh
pnpm test:worker-storage
```

The gate builds first and browser-bundles the fixture from actual built exports.
Pinned Miniflare 3.20250718.3/workerd 1.20250718.0 runs with SQLite-backed Object
namespaces, compatibility date 2025-07-18 and owned persistent temporary storage.
Node 20.19+ is host tooling only; it supplies no SQL engine to the Worker bundle.

## Provider and protocol proofs

- Real SQL bind/result behavior: safe numbers/bigints, booleans, BLOB copies,
  argument snapshots, exact int64 insert metadata through SQL text and unsafe
  numeric-row rejection.
- An INSERT whose result conversion fails rolls back; async callback rejection
  preserves the original error and rolls back its writes. Expired executors,
  manual transaction SQL and root reentrancy reject. Ordinary SQL errors do not
  reconstruct the Object, verified by its boot ID.
- Admission capacity is enforced, repeated close shares a Promise, accepted
  currently-active work drains through a controlled external I/O gate, and closing
  a handle leaves another handle's borrowed platform storage available.
- A failed appended migration rolls back both DDL and history. Changed checksums
  and reordered histories reject on the actual Object database.
- Competing claims get different jobs; current-owner renewal/completion works,
  stale tokens fail, expiry recovers attempts and a retry time is persisted.
- Injected dispatch failure between occurrence insert and cursor update rolls
  back both. Concurrent dispatchers commit one occurrence; cancellation prevents
  later dispatch.
- A real `state.abort()` interrupts that same dispatch window. The next request
  reaches a newly constructed Object, with neither an occurrence nor an advanced
  cursor from the aborted transaction. This is native Object interruption, not
  merely a thrown test exception.
- Disposing and restarting the whole workerd host against the same storage retains
  samples, queue attempts and schedule state while creating a new Object instance.

## Application and launcher proofs

The gate runs the compiled report example, checks validation and the lack of a
public tick route, persists pending work/definitions/cancellation, then restarts
workerd before invoking a real platform scheduled event. It verifies report results,
completed cursors, replay without extra dispatch, competing HTTP producers and
results retained after another host restart.

It also starts the standalone launcher with an owned temporary DURABLE_DATA_PATH,
enqueues over TCP, dispatches via this pinned host's local scheduled-control route,
reads the completed result and verifies awaited SIGTERM disposal and closed socket.
Fixture control/fault routes are absent from the example. Temporary storage,
gateway holds and child processes are released in finally; normal example data,
Cloudflare accounts and system database services are untouched.

These checks prove the declared local engine/compatibility path. They do not prove
live-account deployment, platform quotas, D1 compatibility, cross-Object transactions,
or execution after platform termination. The existing scheduler/queue suites retain
their portable and Node/PostgreSQL coverage. Build/typecheck/unit and generated
project/runtime gates also protect distribution and the prior Fetch/scheduled path.
