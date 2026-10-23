# Tests

Run `pnpm test` from the workspace root. Vitest resolves implemented workspace packages
to their TypeScript sources, so tests do not depend on an existing `dist/` build.

Tests live beside the behavior they cover:

- `packages/container/src`: tokens, providers, singleton resolution, overrides, cycles.
- `packages/core/src`: runtime registry, HTTP composition, DI, bindings, adapter delegation.
- `packages/core/src/lifecycle.test.ts`: startup sharing, resource ordering, rollback,
  bind failures, and shutdown/startup races.
- `packages/core/src/logging.test.ts`: correlated requests and errors, response IDs,
  and omission of request bodies, headers, and query values.
- `packages/logger/src`: structured records, filtering, redaction, serialization, and sinks.
- `packages/http/src`: default JSON errors and preservation of intentional HTTP responses.
- `packages/validation/src`: schema transforms, async refinements, vendor-independent
  parsing, normalized issues, typed Hono targets, and HTTP error behavior.
- `packages/config/src`: typed settings, source precedence, defaults, and configuration errors.
- `runtimes/node/src`: actual TCP requests, occupied ports, invalid ports, repeatable shutdown.
- `runtimes/node/src/config.test.ts`: real environment files, process isolation,
  source snapshots, optional files, and file errors.
- `runtimes/node/src/sqlite.test.ts`: native SQLite values, transactions, concurrent
  handles, migration history, foreign keys, and connection lifetime.
- `examples/basic/src`: full tasks workflow over TCP and invalid/missing-resource requests.
- `examples/basic/src/config.test.ts`: defaults, invalid startup settings, and settings in DI.
- `examples/basic/src/storage.test.ts`: SQLite-backed HTTP, reopened applications,
  durable updates/deletion, concurrent creates, and failed-bind cleanup.
- `cli/src/generator.test.ts`: selected dependency closure, independent copies,
  filesystem boundaries, validation, and rollback without partial projects.
- `cli/src/commands.test.ts`: help/version, parsing, project checks, script delegation,
  and exit status.
- `packages/auth/src`: credential/session invariants, lifetime, revocation, throttling,
  public output, secure cookie policy, unsafe origins, and guards.
- `runtimes/node/src/passwords.test.ts`: actual scrypt, salts, exact comparison,
  dummy verification work, queue admission, and resource/input limits.
- `runtimes/node/src/auth-store.test.ts`: native SQLite account/session/attempt
  invariants, cross-handle visibility, transactional rotation, and concurrency.
- `examples/auth/src/app.test.ts`: protected HTTP, owner isolation, current roles,
  rotation, logout/all-device revocation, expiry, limits, and omission of secrets.

Network tests use ephemeral loopback ports and close their servers after execution.
Additional cross-package suites can live in this directory when needed; add them to
the explicit include list in `vitest.config.ts`.

`pnpm test:persistence` builds first and runs a separate-process integration check
from `scripts/verify-persistence.mjs`. It uses temporary SQLite files, restarts the
executable, exercises simultaneous writers, and checks migration count and integrity.

## Runtime checks

Unit suites cover shared listener defaults and invalid options, Bun/Deno wrong-host
errors, and Workers argument identity, binding isolation, shared startup, waitUntil
forwarding, and platform-level rejections.

`pnpm test:runtimes` builds and launches actual pinned Bun/Deno executables for native
TCP/lifecycle/error checks and portable host examples. It runs the browser Worker
bundle in local workerd, checking bindings, validation, structured logs, request IDs,
and waitUntil-backed KV writes. See `scripts/verify-runtimes.mjs`.
The same harness starts the standalone local Worker host and checks signal cleanup
and a successful process exit.

## Generated project checks

`pnpm test:projects` builds first, then creates all runtime starters through the built
CLI entrypoints in temporary locations outside the workspace. It relocates projects,
installs dependencies, runs TypeScript and the generated Fetch tests, builds, serves
HTTP through actual runtimes, edits source to check watching, and checks shutdown.
This verifies package distribution and host behavior beyond the generator unit tests.
The harness also installs both locally packed CLI archives, exercises their binaries
and automatic installation, and verifies retryable installer failure.

## Authentication checks

`pnpm test:auth` builds and runs `scripts/verify-auth.mjs` with actual native scrypt
and temporary SQLite files. It exercises two users and multiple processes, restarts,
owner-scoped notes, current roles, cookie/origin boundaries, rotation, expiry,
all-device revocation, durable throttling, database representations/integrity, and
shutdown. Its separate browser bundle executes shared auth in actual workerd with
explicit test-only password/store providers. Native password security is verified
on Node; the Worker fixture is a portability check.

## Event checks

`packages/events/src/events.test.ts` covers typed identity behavior, async order,
independent emission overlap, concurrent/recursive once reservation, removal/signal
ownership, scopes, errors, frozen metadata, correlation, nested drain, and close.
`events.typecheck.ts` contains compile-only negative payload/listener contracts.
The tasks event suite verifies committed observations over TCP, failure isolation
without payload logging, no events for unsuccessful writes, independent apps,
startup rollback, and event/database cleanup ordering.

`pnpm test:events` runs the same built-package contract on Node, Bun, Deno, and a
browser bundle in actual local workerd, then checks the compiled tasks app's HTTP
activity, logs, shutdown, and restart boundary. `pnpm test:runtimes` checks awaited
echo events in the portable app, and `pnpm test:projects` checks the generated
starters' event module, route, and request correlation after fresh installation.

## Cache checks

`packages/cache/src/cache.test.ts` covers falsy/undefined hits, TTL boundaries,
copy isolation, shared loading, unrelated-key concurrency, invalidation fencing,
asynchronous store barriers, errors, LRU, and drain. A host-receiver regression
guards the structuredClone behavior found in actual workerd. `cache.typecheck.ts`
contains negative contracts for value types and miss narrowing.

The task cache suite verifies source-call counts, TTL, local invalidation, a write
racing an older loader, provider-failure bypass, source errors, and event/cache/SQL
cleanup ordering. `pnpm test:cache` checks built exports on all four runtimes and
real task HTTP/restarts, including external-write TTL. Runtime/project gates exercise
the public cached profile and explicit invalidation after fresh installation.

## Queue checks

`packages/queue/src/queue.test.ts` covers typed JSON snapshots/limits, delays,
concurrent ownership, retries, crash recovery, stale tokens, heartbeat/abort,
operational errors, queue drain, worker concurrency, observer errors and timer
fairness. `queue.typecheck.ts` verifies negative payload/handler contracts.
`examples/jobs/src/store.test.ts` applies a common contract to memory and SQLite,
including migration replay, state constraints and lease-boundary transitions.
The jobs app suite exercises validation/status, idempotent effects and polling.

`pnpm test:queues` executes built portable contracts on Node/Bun/Deno/workerd,
then actual SQLite consumer processes, forced SIGKILL recovery/final-attempt
exhaustion, automatic heartbeat across multiple lease periods, and report HTTP
enqueue/processing/restart persistence. Temporary SQLite files isolate all data.

## Scheduler checks

`packages/scheduler/src` covers UTC cron syntax/calendar boundaries, immutable
definitions, typed queue payloads, implicit-start registration, latest/catch-up
policy, cancellation, shared ticks, provider errors, runner lifecycle and accepted
async registration/dispatch drain. Compile-only negatives guard payloads and policy.
`examples/jobs/src/schedule-store.test.ts` applies a common memory/SQLite contract
and injects failure after queue insertion to prove cursor/job rollback. App tests
cover registration/status/cancel, invalid/conflicting input, timed report execution
and preservation of the deployed queue/report migration prefix.

`pnpm test:scheduler` runs built exports on Node/Bun/Deno and browser-bundled
workerd using the paired memory provider, then launches actual SQLite dispatcher
processes. It checks unique occurrences, cursor preservation, cancellation, SIGKILL
inside a write transaction, recovery/integrity, and compiled HTTP disabled-host
registration -> restart dispatch/process -> cancel -> restart persistence.

## Observability checks

`packages/observability/src` covers readiness phases/deadlines/coalescing/busy slots,
dependency drain, fixed typed metric labels, aggregation/capacities, Prometheus
escaping/buckets, trace context/version/sampling, explicit hierarchy, bounded serial
export, provider/observer errors, privacy, strict APIs, snapshot isolation and close.
Hono tests exercise templates, ALL routes, misses, 5xx/client responses and excluded
paths. Compile-only contracts guard metric labels and sampling types. Jobs tests
prove SQL/worker readiness, exporter isolation, safe output/log correlation and
readiness-before-SQL/tracing-after-SQL cleanup.

`pnpm test:observability` runs built exports on Node/Bun/Deno/workerd, then actual
HTTP failure/recovery, raw-path cardinality bounds, propagated contexts, 5xx metrics,
signal-driven unready/liveness windows and exporter cleanup. The compiled jobs host
checks real report processing and handler/worker diagnostics. Runtime/project gates
check readiness/metrics/traces in portable apps and freshly installed starters.

## PostgreSQL checks

The ordinary suite validates new configuration/dialect boundaries and SQLite boolean
compatibility without reaching an external database. vitest.postgres.config.ts is
explicitly separate; its .postgres.test.ts files require the owned native harness.
`pnpm test:postgres` provisions PostgreSQL 18.4 with generated passwords and distinct
owner/runtime roles, then runs provider/app cases for scalar precision, parameters,
transaction errors/drain, reentrancy, expired contexts, admission capacity, session
reset, server deadlines, forced connection loss, migration history/rollback, paging,
privileges and HTTP/pool lifetime.

It additionally races actual migration processes, kills one before migration metadata
commit, checks recovery, runs the compiled migration CLI, starts two restricted-role
HTTP writers, restarts HTTP to verify persistent data, and tests authentication
failure. Temporary clusters are stopped/removed; no normal service/data is changed.
See [the PostgreSQL guides](../docs/postgres-local.md) for platform/setup boundaries.

The same gate covers PostgreSQL queue/schedule providers: competing row locks,
lease/retry/fencing rules, incremental expiry recovery, atomic occurrence/cursor
writes, cancellation races and restricted report endpoints. Separate processes
consume/dispatch concurrently, are killed before/after effects and inside dispatch,
then recover without duplicate effects/occurrences. Producer-only HTTP schedules
survive restart into an enabled worker/timing host. See [background proofs](../docs/postgres-background-testing.md).

The account extension verifies PostgreSQL credentials/session/throttle contracts,
private-note ownership/cursors, cookie/origin boundaries, exact expiry and denied
unneeded writes. Compiled hosts use real scrypt across processes/restarts; counters
share their limit and SIGKILL inside replacement rolls back new/old session changes.
See [account verification](../docs/postgres-auth-testing.md) for fixture/provider boundaries.

## OTLP collector checks

`pnpm test:otlp` verifies built exports on Node/Bun/Deno/workerd against a real pinned
OpenTelemetry Collector. Its JSON receiver forwards normalized data to an owned sink;
assertions cover IDs/parents, nanos, enum/scalar/resource mapping, retries and close.
A controlled HTTP gateway tests partial/permanent/redirect/oversized/stalled responses.
The compiled jobs host proves persisted report work alongside remote spans, outage
isolation, safe diagnostics/privacy and final drain. Unit tests also exercise a custom
Fetch that ignores abort without allowing repeated orphan requests. See [native setup](../docs/otlp-native.md).

## Managed work and scheduled Workers

`packages/core/src/work.test.ts` covers shared HTTP/work startup, callback values
and original errors, resource drain, late admission and startup/close races.
`runtimes/workers/src/scheduled.test.ts` covers original platform object/method
ownership, exact returned/waitUntil Promise identity, input/options, capacity,
cooperative and ignored abort, registration failure and awaited final work.

`pnpm test:worker-scheduled` uses actual workerd scheduled dispatch and controlled
I/O/export gates, then verifies the compiled KV audit example across replay and
fresh isolates, missing-binding policy and the standalone signal-driven launcher.
The generated-project gate invokes the starter's real local scheduled handler and
asserts metadata/counter observations and a consumer span after independent install.
See [native scheduled proofs](../docs/workers-scheduled-testing.md).

## Durable Worker storage

`pnpm test:worker-storage` browser-bundles built exports into real workerd with an
owned persisted SQLite Object namespace. It checks binds/results/exactness and
conversion rollback, async callback values/errors, expired executors, input-gate
error isolation, DDL/history rollback, capacity and active-work close. Native store
tests cover competing claims, retry/renewal/expiry/stale fencing, concurrent dispatch,
cursor/job rollback and cancellation. Actual Object abort interrupts an uncommitted
dispatch; a fresh Object and then full-host restart check authoritative SQL state.

The compiled report example persists pending jobs/definitions before restart,
receives real platform scheduled events, preserves results after another restart
and accepts competing HTTP producers. The standalone launcher uses a temporary
path for real TCP/trigger/shutdown checks. See [all native proofs](../docs/workers-durable-testing.md).

## Platform queue events

`runtimes/workers/src/queue.test.ts` covers exact completion registration, original
objects/method receivers, array/options snapshots, bounded pools, explicit decisions,
ordered errors, malformed batches, startup/registration failure and cooperative/
ignored abort through core/adapter drain. The afterBatch test holds final work open
after successful explicit ack and preserves its later failure.

`pnpm test:worker-queues` executes native workerd event dispatch, inspects actual
partial-decision flags, drives real broker retry/dead-letter delivery, and holds
I/O/export during cancellation/close. The compiled example proves automatic broker
consumption and persistent Object SQL receipts, then exercises the standalone TCP
host with temporary data. The pinned broker's explicit-ack retry limitation is
documented separately from native flags. See [all queue-event proofs](../docs/workers-queue-testing.md).

## Durable Object alarms

`pnpm test:worker-alarms` runs built exports on actual SQLite-backed workerd Objects.
Future-clock contract cases test transactional SQL/alarm rollback after set and
state.abort, all-handle ownership, no sliding wakeup, recurring/bounded processing,
64 queue scopes, retry/lease projection, durable backoff and startup/close races.
Real-time cases observe actual native alarms reconstructing a reset Object without
HTTP, recovering after effect commit and chaining multiple bounded batches.

Full local-host restart needs a known-Object activation plus a changed-time refresh
to rebuild this pinned runtime's alarm index; that bootstrap is explicit in both
the test and launcher. The compiled report host checks automatic processing,
cancellation, tracing/privacy, persisted results and TCP disposal with temporary
data. Existing storage/queue/scheduled and generated-project/native-runtime gates
protect the provider's default path. See [native proof](../docs/workers-alarm-testing.md).

## Managed transaction publishing

Database scope tests cover exact owner/provenance, frozen/expired executors,
synchronous admission, accepted participant drain, sealed scopes and ordered
failure/abort. Jobs SQLite integration tests verify business/job commit/rollback,
async validation through queue close, caught-failure poisoning, root/cloned/
expired/foreign rejection and unsupported/closed queues. Type negatives preserve
payload inference for the new helper.

`pnpm test:transaction-publishing` proves actual SQLite/PostgreSQL process visibility
and SIGKILL windows, competing writers, restricted task/report HTTP and a job
insertion permission failure. The Object fixture proves business/job/alarm commit,
callback-return drain and real native consumption. Existing full PostgreSQL,
queue/scheduler, Object alarm/storage and project/runtime gates protect prior paths.
See [native proof](../docs/transaction-publishing-testing.md).

## Durable request idempotency

Idempotency source tests prove strict bounded JSON snapshots/fingerprints and
actual SQLite task/job/request atomicity, replay, scopes/conflicts, failed work,
caught publishing failure, expiry and bounded deletion. Type negatives reject
lossy request/result types. `pnpm test:idempotency` adds separate-process SIGKILL,
native PG ownership, two-host/restarted HTTP and actual Object abort/alarm proofs.
The full PG, transaction-publishing and project gates protect existing paths.
See [idempotency verification](../docs/idempotency-testing.md).

## Transactional outgoing delivery

Outbox tests use real SQLite for staging/rollback, stable envelope retries, bounded
terminal cleanup and publisher/maintenance close drain. The binding adapter must
await actual acceptance even after cancellation. `pnpm test:outbox` adds native SQL
process SIGKILL, actual broker duplicate deliveries, distinct transport IDs with
one SQL effect, Object alarm/reset/restart recovery and the compiled local host.
The existing platform/request/project gates protect the reused engine and exports.
See [outbox verification](../docs/outbox-testing.md).

## Failed outgoing inspection and retry

Recovery source tests cover scoped/tied keyset pages, explicit metadata, conditional
single-winner retry, immutable IDs/payloads, cumulative ceilings, delays, stale
requests at the same time, cap/ineligible/missing states, old-lease fencing and
close drain. `pnpm test:outbox-recovery` adds native process interruption/contention,
maintenance races, actual broker deduplication, prior Object history upgrade,
authorized HTTP cursor/validation and alarm-abort rollback. Existing outbox,
project and alarm gates protect the reused foundations and exported artifacts.
See [native recovery verification](../docs/outbox-recovery-testing.md).

## Recovery audit durability

Audit source tests verify attributed result records, append-trigger rollback,
valid non-success actions, rejected attribution, concurrency, tied/scoped pages,
history after delivery deletion, independent retention, close drain and failure
on an undeployed audit schema. `pnpm test:outbox-audit` adds native SQL process
interruption/permissions, minimal maintenance roles, prior Object history upgrade,
actual event/state/alarm rollback, authenticated HTTP history and credential/actor
rotation. The recovery/outbox/project gates protect existing behavior and exports.
See [audit verification](../docs/outbox-audit-testing.md).
