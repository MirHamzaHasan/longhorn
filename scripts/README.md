# Maintenance Scripts

Repository automation, build scripts, and publish utilities for LONG HORN packages.

## Persistence verification

Run `pnpm test:persistence` from the workspace root. This builds the framework and
example, then runs `verify-persistence.mjs` against temporary SQLite files. It verifies
restarts, two simultaneous writer processes, updates, deletions, migration history,
file format, and integrity without changing the normal example database.

## Native runtime verification

`pnpm test:runtimes` builds, then runs `verify-runtimes.mjs`. Actual local Bun/Deno
binaries execute transport/lifecycle fixtures and host examples. Local workerd
executes the browser Worker bundle, including bindings and background KV work.
No account credentials or deployment are used. See [the portable example](../docs/portable-example.md).

`pnpm dev:bun`, `pnpm dev:deno`, and `pnpm dev:workers` run examples interactively.
`serve-worker.mjs` owns the local Miniflare host and disposes it on signals.
The native verification checks this host's shutdown as a separate child process.

## Generated project verification

`pnpm test:projects` builds then runs `verify-projects.mjs`. It invokes both CLI
entrypoints, generates every runtime in temporary directories outside the monorepo,
relocates the projects to paths with spaces, installs dependencies, and runs project
typechecks, tests, builds, native/local Worker HTTP hosts, source reloads, and cleanup.
Framework snapshots are local; third-party installs use pnpm normally. This check
does not require global Bun/Deno installations, account credentials, or deployment.
It also packs and installs both CLI packages locally, executes their package binaries,
and checks successful and failed automatic installation.

`pnpm create:app ../my-api --runtime node` builds the generator and creates a project.
`pnpm longhorn <arguments>` runs the built CLI. See [CLI](../docs/cli.md).

## Authentication verification

`pnpm test:auth` builds and runs `verify-auth.mjs`. Actual native scrypt and multiple
Node processes exercise temporary SQLite auth state, restart/revocation, cookie and
origin policy, roles, owner-scoped notes, expiry, throttling, integrity, and logs.
It also browser-bundles shared auth and runs it in workerd using explicit test-only
providers. It creates no normal example accounts and changes no normal example data.
`pnpm dev:auth` runs the separate [auth example](../docs/auth-example.md).

## Event verification

`pnpm test:events` builds then runs `verify-events.mjs`. Node/Bun/Deno execute the
same runtime-neutral contract fixture against built package exports; workerd runs
its browser bundle. The harness then uses temporary task SQLite files and real TCP
to verify awaited CRUD observations, correlation/log privacy, shutdown, and the
restart boundary between durable tasks and process-local activity.

## Cache verification

`pnpm test:cache` builds then runs `verify-cache.mjs`. The same built cache/memory
contract runs in Node/Bun/Deno and browser-bundled workerd. Native HTTP then checks
concurrent summaries, source computations, local invalidation, external-write TTL,
uncached reads, restart, and cleanup with temporary SQLite files only.

## Durable queue verification

`pnpm test:queues` builds then runs `verify-queues.mjs`. The portable bounded
contract executes on Node/Bun/Deno and actual workerd with the memory reference
store. Separate Node processes use temporary SQLite files to prove distinct claims,
retry persistence, SIGKILL lease recovery, exhausted crash failure, heartbeats for
long-running work, and one idempotent effect per job. Compiled report HTTP hosts
verify 202/status headers, worker-disabled enqueue, processing after restart,
shutdown, and persisted results after another restart. All children are owned and
cleaned up; normal example databases are untouched.
`pnpm dev:jobs` runs the [report app](../docs/jobs-example.md) interactively.

## Schedule verification

`pnpm test:scheduler` builds then runs `verify-scheduler.mjs`. A shared portable
fixture executes on Node/Bun/Deno/workerd, checking immutable registration, missed
policies, cancellation, UTC cron and draining with paired transient storage.
Two SQLite dispatcher processes start together and enqueue distinct occurrence IDs.
A third is killed after insertion but before its cursor update, proving transaction
rollback and restart recovery. Compiled report hosts verify registration while
timers are disabled, processing after restart, conflicts, cancellation and another
restart. Temporary files/owned processes isolate the QA from normal example data.
See [scheduled reports](../docs/scheduled-reports.md) for interactive commands.

## Observability verification

`pnpm test:observability` builds then runs `verify-observability.mjs`. The same built
health/metric/tracing contract runs in Node/Bun/Deno and actual browser-bundled
workerd. An isolated HTTP fixture changes a fake dependency from healthy to failing
and back, then verifies privacy/cardinality/context/error metrics and a signal-driven
unready period before final resource/exporter cleanup. Test-only control routes
exist only in that fixture. A separate compiled report host exercises real SQL,
background handler metrics/spans, enriched logs and graceful readiness draining.
All files/processes are temporary and owned; normal example data is untouched.
Runtime/project gates also exercise the same public diagnostics in portable apps
and generated starters after independent installation.

## PostgreSQL verification/demo

`pnpm test:postgres` builds and runs verify-postgres.mjs against a newly initialized
native cluster. postgres-cluster.mjs owns its temporary directory/server; the sandbox
adds isolated nonsuperuser deployment/runtime roles and applies actual example
migration exports. Provider/app native tests are followed by separate-process
migration concurrency/SIGKILL recovery, a compiled migration invocation, two HTTP
writers, cursor pages, boolean updates, HTTP restart persistence and wrong-password
rejection. It closes owned pools/processes and removes only temporary data.

`pnpm demo:postgres` uses that same isolated bootstrap for a disposable local API at
port 3003. Ctrl+C removes demo data. `pnpm migrate:postgres` and `pnpm dev:postgres`
instead use explicitly configured persistent server URLs. See [local PostgreSQL](../docs/postgres-local.md).

fixtures/postgres-background.mjs drives native consumer/dispatcher barriers and
SIGKILL windows. The PostgreSQL gate proves queue recovery before/after committed
idempotent effects and atomic cursor/occurrence rollback. It retires synthetic-clock
backlogs before starting real-clock report HTTP hosts. See [background verification](../docs/postgres-background-testing.md).

postgres-auth-checks.mjs extends the same gate with compiled account hosts/native
scrypt, private-note isolation, shared sessions/roles/throttling and secret-free logs.
fixtures/postgres-auth.mjs drives reservation barriers and a SIGKILL after session
replacement writes. Both use only the owned cluster and supplied restricted credentials;
see [account proofs](../docs/postgres-auth-testing.md).

## OTLP collector and demo

verify-otlp.mjs uses otel-collector.mjs and tooling/otelcol.json to verify the official
archive checksum, extract a per-run native binary and start an owned loopback JSON
receiver/forwarder. Runtime fixtures and a scripted gateway distinguish real collector
interoperability from fault-policy tests. demo-tracing.mjs pairs that collector with
an owned temporary report database; startup cancellation and normal drain release both.
The cache stays in node_modules; system services are never changed. See [the guide](../docs/otlp-native.md).

## Workers scheduled-event verification

`pnpm test:worker-scheduled` builds then runs verify-worker-scheduled.mjs against
actual local workerd scheduled events. A controlled gateway holds handlers/export
open to prove admission, abort and concurrent core/adapter cleanup ownership.
The compiled audit example tests stable KV replay, a fresh isolate with persisted
test KV, transient invocation state and missing-binding noRetry policy. The gate
also launches serve-scheduled-worker.mjs, invokes the pinned local trigger and
verifies clean signal shutdown. It owns all temporary data and processes.

`pnpm dev:scheduled-worker` starts that local host at port 3005 with temporary AUDIT
KV and prints the manual trigger URL. No automatic timer, cloud account or deployment
is created. Project verification also triggers the independently installed Workers
starter and checks its consumer span. See [scheduled native proofs](../docs/workers-scheduled-testing.md).

## Durable Worker storage and reports

`pnpm test:worker-storage` builds then runs verify-worker-storage.mjs with an owned
SQLite-backed Durable Object namespace. The browser fixture proves real scalar
conversion/snapshots, transaction/DDL rollback, executor ownership, admission/close,
queue leases/fencing and atomic dispatch/cancel. state.abort interrupts a real
dispatch between occurrence/cursor writes; a fresh Object checks rollback, then
a full workerd restart proves persistence. The compiled report example checks
pending work across restart, real scheduled processing, replay and committed results.

serve-durable-worker.mjs runs that example at port 3006 via `pnpm dev:durable-worker`.
Its normal data path is examples/durable-worker/data/objects; DURABLE_DATA_PATH
selects another path. The native gate supplies a temporary path and verifies real
TCP/manual triggering and signal disposal without changing normal example data.
See [native storage proofs](../docs/workers-durable-testing.md).

## Platform queue-event verification

`pnpm test:worker-queues` builds then runs verify-worker-queues.mjs. A test-only
native service binding dispatches workerd queue events and inspects partial
ack/retry/error flags. Separate actual producer/broker tests prove increased-attempt
redelivery and dead-letter routing. Controlled I/O/export gates verify bounded
message/batch work and ignored-abort close ownership. The gate documents the pinned
broker's explicit-ack redelivery limitation rather than claiming it matches every
production behavior.

The compiled example verifies HTTP publish, automatic consumption, idempotent
Object SQL receipts, malformed-message acknowledgement policy, trace privacy and
receipt persistence across fresh workerd. serve-queue-worker.mjs runs it at port
3007 through `pnpm dev:queue-worker`, using examples/queue-worker/data/objects or
RECEIPT_DATA_PATH for receipts. The gate supplies temporary paths and tests TCP/
shutdown only after its receipt completes. See [native proofs](../docs/workers-queue-testing.md).

## Durable Object alarms

`pnpm test:worker-alarms` builds then runs verify-worker-alarms.mjs. Controlled
native SQL cases cover atomic setAlarm rollback/interruption, earliest/cancel/lease/
retry planning, 64 scopes, activation guards, persisted failure floor and lifecycle
drain. Separate real-time cases observe actual alarms after Object reset, committed
effect interruption and multiple bounded backlog batches. Cold local-host restart
is verified with an explicit startup activation/projection refresh, not an assumed
global alarm index. See [native proof](../docs/workers-alarm-testing.md).

serve-alarm-worker.mjs starts the shared report app's alarm entry at port 3008 via
`pnpm dev:alarm-worker`, with data/alarms or ALARM_DATA_PATH for Object storage. It
activates the known report Object once before its listening log; native alarms do
the processing. The gate uses temporary storage, automatic TCP report completion
and signal disposal. Normal example data and cloud accounts remain untouched.

## Atomic business/job publishing

`pnpm test:transaction-publishing` builds and runs verify-transaction-publishing.mjs.
Owned SQLite/PostgreSQL writers pause before commit while independent observers
check both rows remain invisible. SIGKILL before commit rolls both back; after
commit preserves both. Concurrent producers and committed-row consumers follow.
The gate also checks async/caught-failure scope semantics, restricted task/report
HTTP, permission-failure rollback and processing after producer-host restart.

The Object fixture verifies business/job/alarm rollback after native alarm writes
and actual reset, async schema drain, persisted state and automatic native-alarm
consumption. Cleanup owns every child/pool/cluster/temporary path. Existing normal
services and example data are untouched. See [native proof](../docs/transaction-publishing-testing.md).

## Durable request replay

`pnpm test:idempotency` builds and runs verify-idempotency.mjs. Owned native SQLite
and PostgreSQL producers contend on keys, die before/after commit, and verify
business/job/request visibility, replay/conflict, expiry and bounded cleanup.
Two compiled PG hosts prove normalized HTTP retries, permission rollback and
restart replay. Actual Object resets prove atomic SQL/alarm rollback and lost
postcommit-response recovery; a real native alarm consumes one committed effect.
Cleanup owns the fixture processes/storage/pools/cluster. See
[the proof guide](../docs/idempotency-testing.md).

## External broker outbox

`pnpm test:outbox` builds and runs verify-outbox.mjs. Native SQLite/PostgreSQL
processes prove atomic business/outgoing state and interruption before send/after
actual broker acceptance. Real workerd Queue deliveries preserve one application
message ID across distinct transport IDs and one SQL effect. Object fixtures prove
SQL/alarm rollback, pending work across host restart, acceptance/reset redelivery,
request replay and persisted receipts. The local launcher is exercised over TCP
and must dispose its workerd on signal. Every fixture path/process/pool/cluster is
owned and cleaned. See [native proof](../docs/outbox-testing.md).

## Deliberate outgoing recovery

`pnpm test:outbox-recovery` builds and runs verify-outbox-recovery.mjs. Owned SQLite/
PostgreSQL processes prove conditional retry visibility/commit/SIGKILL, single-winner
operator contention, metadata pages and retry/prune races. Real broker sends keep
one application ID and one effect. A legacy-history Object fixture proves upgrade,
optional authorization, actual retry/alarm rollback, automatic redelivery and HTTP
cursor/validation behavior. The launcher checks the token binding without secret
output. All temporary processes/pools/storage/cluster instances are disposed.
See [the recovery proof](../docs/outbox-recovery-testing.md).

## Transactional recovery audit

`pnpm test:outbox-audit` builds and runs verify-outbox-audit.mjs. Real SQLite/PG
processes prove transition/append visibility, SIGKILL rollback versus retained
commit and concurrent action outcomes. Restricted PG permissions prove failed
append rollback, runtime mutation denial and minimal audit maintenance privileges.
Object fixtures prove prior-history upgrade, retry/event/alarm rollback, one
broker effect, scoped history/retention and credential/actor rotation. The launcher
checks actor binding and authenticated TCP reads/writes without secret output.
Owned fixture resources are always disposed. See [native audit proof](../docs/outbox-audit-testing.md).

[Request attempt limits](../docs/request-limits.md) connect bounded memory and managed SQL to Hono.
The command application has a default-off authenticated account budget, checked by
startup/readiness/preflight and preserved by backup. Run pnpm test:rate-limits for
actual runtime, SQL contention/crash, upgrade and HTTP verification.
