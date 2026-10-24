# Native Deno SQLite verification

Owners: [native tests](../runtimes/deno/test/sqlite.test.mjs),
[process fixture](../scripts/fixtures/deno-sqlite-process.mjs),
[permission fixture](../scripts/fixtures/deno-sqlite-permissions.mjs) and
[verification gate](../scripts/verify-deno-sqlite.mjs).

```sh
pnpm test:deno-sqlite
```

The command builds TypeScript first, then executes the shipped provider with the
pinned Deno 2.9.6 binary. Fourteen native tests cover int64/real/blob/boolean/null
values; snapshots; named/numbered/anonymous slot identity, holes and unchanged
column names; exact bind arity; single-statement/control rejection; direct change
metadata with triggers; async DDL rollback; automatic native rollback fencing;
same-file/symlink ownership; bounded admission and close; joined participant drain;
result-limit ambiguity; sanitized failures; migration/reopen and existing
queue/scheduler/replay stores. Native execution is not mocked by a Node fixture.

The gate launches separate Deno processes with limited permissions. Memory works
with no filesystem grant, while missing read or write rejects file acquisition.
ATTACH outside the granted directory fails without creating the target. Paths
include spaces and #, and canonical /var aliases on macOS keep the originally
granted open path while sharing file identity for in-process coordination.

Real writer contention rejects without replay. SIGKILL before commit leaves no
effect; SIGKILL after commit retains it. A subsequent integrity check succeeds.
Native Deno HTTP proves validation/CRUD, two writers, persisted restart, local
activity reset and SQL summaries. It traverses 1029 tasks in bounded pages,
checks completion filtering/counts, then inserts the maximum signed int64 ID and
proves exact cursor/read behavior after another restart.

Actual Node libSQL and Bun SQLite peers then read all 1030 retained tasks and the
wide ID, commit updates, and the next Deno host serves their effects. The gate owns
only its spawned children and temporary directories and joins cleanup on failure.

Deno 2.9.6's native iterate path was observed to end silently on a constraint
error. The provider uses all() so native step errors propagate, including
OR ROLLBACK. Native result materialization therefore precedes output checks;
budgets do not cap native allocation, CPU time or blocking lock waits. A rejected
autocommit RETURNING result may already have persisted. These boundaries are
tested/documented rather than covered by query replay.

The existing source-and-runtimes CI job also runs this gate. Local macOS ARM64
results and hosted Ubuntu execution remain separate evidence. Managed deployment,
network filesystem guarantees, replication and Windows behavior require their
own proof. See [provider](deno-sqlite.md),
[transactions](deno-sqlite-transactions.md), [bindings](deno-sqlite-bindings.md)
and [host](deno-sqlite-tasks.md).

## Local evidence

On macOS ARM64 with Deno 2.9.6, Node 20.19.4 and Bun 1.4.4, frozen install,
full TypeScript build/type checks and 534 source tests in 87 files passed. The
14-test Deno suite and full native permissions/crash/HTTP/interoperability gate
passed, as did the existing Bun SQLite gate (13 native tests), native runtime
gate and all four generated API project gates. The exact development runtime
command also persisted a task using its default relative directory grants.
Documentation validation checked 325 Markdown files/2886 local links and retained
the original LICENSE blob. Hosted exact-head checks are recorded separately.
