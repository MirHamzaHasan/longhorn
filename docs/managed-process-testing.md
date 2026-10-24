# Managed process and native jobs verification

Owners: [process tests](../runtimes/node/src/process.test.ts),
[resource tests](../examples/jobs/src/report-resource.test.ts) and
[owned native gate](../scripts/verify-owned-native-reports.mjs).

```sh
pnpm test
pnpm test:owned-native
```

Process source tests use actual Node child executables. They verify literal argv
and environment snapshots, explicit inheritance/deletion, startup abort after
process entry, acquisition-only signals, split UTF-8 lines, parser/async parser
failure, startup timeout, line/stdout/stderr limits, output overflow after readiness,
forced SIGKILL reporting, unexpected exit and independent sibling ownership.
Normal/forced/aborted paths check actual PID disappearance, not just an elapsed
timer. Repeated close returns the same promise and waits for the child's drain.

Application source tests use actual in-memory SQLite and a blocked queue handler
to prove async factory acquisition, pre-start DI rejection, queue-before-compute-
before-database release and database rollback on failed computation acquisition.

The built gate uses the actual locked Rust binary for authenticated health,
computation, Node HTTP jobs and persistence. It restarts the host with retained
SQLite, kills the native process, observes readiness failure and a durable failed
attempt, then restarts the host to complete that job with a new service. Occupied
API bind and missing executable cases reject readiness and release acquired
resources. The development launcher is also exercised with an explicit executable
and signal forwarding through both host and native child.

Two deliberately incompatible test executables exercise acquisition rollback:
one advertises readiness but serves an invalid health protocol; another enters
without ever announcing readiness and is cancelled through the parent host.
These are test fixtures, not evidence of Rust execution. They prove cleanup before
rejection. Fixture executable paths contain spaces. The gate tracks only its own
processes/PIDs, closes listeners and removes temporary storage in finally.

The existing [Rust interoperability gate](rust-reports-testing.md) separately
retains real Node/Bun/Deno/workerd client checks, native handler drain, external
service outage/retry and the temporary demo. The workflow's existing rust-reports
job now runs both gates after the pinned locked build. Local macOS ARM64 execution
and hosted Linux CI results are recorded separately; direct-child ownership does
not establish Windows signal behavior, descendant supervision or crash cleanup.

## Local evidence

On macOS ARM64 with Node 20.19.4, pnpm 12.6.0 and Rust 1.97.1, frozen install,
full build/type checks and 534 source tests in 87 files passed. Cargo formatting,
two Rust tests and both actual native gates passed. Existing native queue,
scheduler, observability and all three OTLP signal gates passed. Generated API
projects passed install/types/tests/build/watch/shutdown on Node/Bun/Deno/workerd;
the packed/frozen Node SQLite starter passed retained multi-process persistence.
Documentation validation checked 319 Markdown files/2816 local links and the
original LICENSE blob stayed unchanged. Hosted exact-head CI remains separate
from this local execution evidence.
