# Development roadmap

The [feature index](features.md) records implemented behavior and package connections.
This roadmap retains the wider framework direction from [the architecture](architecture.md).
An exported package name alone is a scaffold, not a finished feature.
The agreed [v0.1 delivery plan](v0.1-plan.md) prioritizes history, the web console,
one complete example, persistent setup/deployment and release hardening.

## Foundations implemented

- Hono HTTP composition, Fetch dispatch, and the Node listener adapter.
- Application DI with typed tokens and singleton providers.
- Standard Schema validation for requests and non-HTTP input.
- Typed configuration, Node environment snapshots, and optional environment files.
- Application startup, rollback, and ordered resource shutdown.
- Structured logging, request IDs, and correlated error/completion records.
- SQL contracts, write transactions, checksummed migrations, and the Node SQLite adapter.
- Persistent tasks with lifecycle-owned connections and separate-process verification.
- Native Bun/Deno listeners and a Workers contextual Fetch adapter, with native verification.
- A portable app exercising config, DI, validation, logging, and platform lifetime.
- A development CLI, standalone project generation, and four verified runtime starters.
- Local credentials, native password hashing, opaque sessions, cookie/origin boundaries,
  authorization guards, SQLite auth storage, and a persistent private-notes example.
- Typed in-process events, scoped/signal/once subscriptions, correlated follow-ups,
  lifecycle draining, task activity, and event-enabled portable/generated apps.
- Typed caching, memory LRU/TTL, shared loads, invalidation fences, provider-failure
  policy, cached task summaries, and public profile caches in portable/generated apps.
- Typed queues, JSON/schema validation, delayed jobs, retries, lease renewal/fencing,
  lifecycle-owned workers, SQLite persistence, a memory provider, and report jobs.
- Durable one-time/interval/UTC-cron schedules, immutable IDs, missed-run policies,
  cancellation, atomic SQLite dispatch, lifecycle timers, and scheduled reports.
- Explicit dependency readiness/liveness, bounded metrics, Prometheus text export,
  explicit-context tracing, serial/local span export, HTTP/background diagnostics,
  and observability-enabled portable/generated apps.
- Native Node PostgreSQL pooling, scalar/dialect boundaries, drained transactions,
  schema-scoped checksummed migrations, restricted-role cursor tasks, native QA/demo.
- PostgreSQL queue claims/lease recovery, atomic schedule dispatch/cancellation,
  restricted background task reports and separate-process crash verification.
- PostgreSQL credentials/sessions/throttle storage, restricted account HTTP/private
  notes, native password verification and atomic replacement crash recovery.
- Portable OTLP/HTTP JSON trace export, bounded retries/deadlines/acknowledgements,
  explicit secret-safe configuration, remote report traces and real collector QA/demo.
- Managed non-HTTP lifecycle work, Workers scheduled-event dispatch, bounded
  cooperative invocations, awaited consumer telemetry, KV audit example and starters.
- Durable Object SQLite transactions/schema history, existing SQLite queue/schedule
  protocols over real Object storage, bounded report processing and native abort/restart QA.
- Workers queue-event dispatch, explicit partial message decisions, bounded pools/
  budgets, awaited consumer tracing, real broker receipt example and native retry/DLQ QA.
- Durable Object alarm ownership, atomic SQL wakeup projection, persistent failure
  floor, automatic report batches, lease recovery and native interruption/restart QA.
- Managed transaction provenance/participant drain, typed atomic job publishing on
  SQLite/PostgreSQL/Object SQL, committed task/report HTTP and native visibility/crash QA.

## Persistent application resources implemented

The application-facing async store contract now connects to SQLite through DI and
lifecycle hooks. `pnpm test:persistence` verifies process restarts and concurrent
writers. See [database](database.md), [migrations](migrations.md), and [SQLite](sqlite.md)
for the contracts and concurrency/durability boundaries.

## Runtime portability implemented

[Bun](bun.md), [Deno](deno.md), and [Workers](workers.md) use the shared Fetch and
lifecycle boundaries. `pnpm test:runtimes` executes pinned Bun/Deno binaries and local
workerd, including bindings and background work. Node's SQLite provider remains
Node-specific; the separate [native Bun](bun-sqlite.md) and
[Deno](deno-sqlite.md) providers implement the same callback database contract.

## Project creation implemented

The [CLI](cli.md) and [project generator](project-generation.md) create independent
[starters](starter-templates.md) with explicit runtime selection and bundled framework
snapshots. `pnpm test:projects` checks fresh installation, relocation, typechecking,
tests, builds, HTTP execution, source reloads, and shutdown across all four runtimes.

## Credentials, sessions, and authorization implemented

[Credentials](authentication.md), [password hashing](passwords.md), [sessions](sessions.md),
[HTTP auth](auth-http.md), [authorization](authorization.md), and [SQLite auth storage](auth-sqlite.md)
connect through an isolated [auth example](auth-example.md). `pnpm test:auth` proves
native password verification, session lifetime/revocation across processes, origin
checks, owner-scoped data, current roles, throttling, and restart behavior. Provider
integrations and advanced account lifecycle features remain outside this initial
local-credential module and are recorded in its guides.

## Application events implemented

[Typed events](events.md), [subscription ownership](event-subscriptions.md), and
[task observations](task-events.md) connect to DI, request IDs, and lifecycle. The
bus awaits ordered listeners, aggregates errors, drains accepted child work, and
cleans subscriptions. `pnpm test:events` runs the built contract across all runtime
targets and checks compiled task HTTP/restart behavior. Portable/generated starters
exercise awaited echo events too. These are process-local observations; durable
outbox/queue delivery remains separate.

## Caching implemented

[Typed cache coordination](cache.md), [memory storage](memory-cache.md), and
[task summaries](task-cache.md) connect through DI, config, and lifecycle. Shared
loads and generation fences handle concurrent misses and invalidation without
repopulating from older work. `pnpm test:cache` checks the built contract across
all targets and real HTTP, including the TTL boundary for external process writes.
Normal task reads and auth remain uncached. The optional [Redis provider](redis-cache.md)
now supplies shared standalone Redis 7+ storage through a [schema codec](cache-json-codec.md)
and [owned Node connection](redis-node.md). Its [task profile](redis-tasks-example.md)
and [native gate](redis-cache-testing.md) prove restart retention, server expiry,
namespace isolation, TLS, real command deadlines and authoritative outage fallback.
The coordinator's loader fences remain process-local. Redis Cluster traversal,
distributed version fencing and automatic reconnect/recovery need separate protocols.

## Durable queues implemented

[Queue coordination](queues.md), [workers](queue-workers.md), [SQLite storage](queue-sqlite.md),
[memory storage](memory-queue.md), and [the report app](jobs-example.md) each document
their boundaries. `pnpm test:queues` executes built contracts across runtime targets,
then real concurrent SQLite consumer processes, SIGKILL recovery/exhaustion,
heartbeats, HTTP, and restart. Effects are at-least-once and require idempotency;
outbox coupling, additional providers, retention/admin tooling remain future work.

## Scheduling implemented

[Definitions](scheduler.md), [UTC cron](cron.md), [timing hosts](scheduler-runner.md),
[SQLite dispatch](scheduler-sqlite.md), [memory pairing](memory-scheduler.md), and
[scheduled reports](scheduled-reports.md) have separate guides. SQLite atomically
inserts each queue occurrence and advances its schedule cursor, coordinating same-file
processes without a timer leader. `pnpm test:scheduler` proves multi-process ticks,
SIGKILL inside the dispatch transaction, missed policies, cancellation and restart.
Queue effects stay at-least-once. Timezones, dynamic payloads, admin/retention APIs,
additional providers and further platform triggers remain future extensions.
Workers scheduled-event lifetime is now implemented; see the milestone below.

## Observability implemented

[Overview](observability.md), [health](health-checks.md), [metrics](metrics.md),
[Prometheus text](prometheus.md), [tracing](tracing.md), [memory export](memory-traces.md),
[HTTP instrumentation](http-telemetry.md), and [report diagnostics](jobs-observability.md)
have separate connection/ownership guides. `pnpm test:observability` executes the
built contract across runtime targets and real HTTP, including unhealthy/recovered
dependencies, bounded stuck checks, privacy, export failure isolation and shutdown.
Local metrics/span queues remain process-owned rather than durable state. Optional
OTLP collector delivery is described below; global async context and platform-final
flush guarantees remain outside this implementation.

## Cumulative metric collector export implemented

[Timed collections](metrics.md), [owned readers](metric-reader.md),
[metric OTLP/JSON](otlp-metrics-json.md), [delivery](otlp-metrics.md),
[report integration/demo](jobs-metrics-export.md) and [native proof](otlp-metrics-testing.md)
extend the existing registry. HTTP/background values push independently of tracing
and remain available through Prometheus. The real native collector verifies all
four runtime profiles, serial point batches, cumulative identity, histogram bucket
mapping, failure classification, actual socket cancellation, business work during
collector outage, recovery and final drain. Traces/metrics share bounded HTTP
delivery while preserving signal-specific acknowledgement counts. No delta reset,
log transport or full OpenTelemetry SDK is claimed.

## PostgreSQL provider implemented

[Connection/scalar policy](postgres.md), [transactions](postgres-transactions.md),
[schema history](postgres-migrations.md), [roles](postgres-roles.md),
[cursor pages](postgres-pagination.md), [the app](postgres-example.md), and
[native QA/demo](postgres-local.md) have separate guides. PostgreSQL 18.4 native
tests prove pool/session lifetime, rollback, errors, schema races/crashes, privileges,
HTTP concurrent writers, restart and cleanup. This adds a real provider, not a SQL
translator. Existing SQLite auth/queue/scheduler stores remain provider-specific.

## PostgreSQL background providers implemented

[Queue storage](queue-postgres.md), [schedule storage](scheduler-postgres.md),
[task reports](postgres-reports.md) and [native process proofs](postgres-background-testing.md)
connect the existing coordinators to PostgreSQL. Concurrent consumers/dispatchers,
stale owners, lease renewal, retries, cancellation, rollback and SIGKILL before/after
effects or between occurrence/cursor writes are verified on the real engine.
Producer-only HTTP can persist schedules for a later worker/timing host. Effects
remain at-least-once; explicit idempotency preserves report results.

## PostgreSQL account storage implemented

[Credentials](auth-postgres.md), [sessions](postgres-sessions.md),
[attempt windows](postgres-login-attempts.md), [account HTTP](postgres-accounts.md),
[private notes](postgres-private-notes.md) and [native proofs](postgres-auth-testing.md)
have separate guides. The shared service/password/cookie contracts stay above native
SQL. Real processes prove unique signup, scrypt, shared counters, cookie/origin guards,
live roles, private ownership, restart, expiry and revocation. SIGKILL during session
replacement preserves the old record and rolls back the new one. Account recovery,
MFA/OAuth/passkeys and RLS remain explicit later capabilities.

## OTLP/HTTP trace export implemented

[Transport](otlp-http.md), [JSON mapping](otlp-json.md), [delivery](otlp-delivery.md),
[configuration](otlp-configuration.md), [reports](jobs-otlp.md) and [native QA](otlp-native.md)
have separate guides. Built code on Node/Bun/Deno/workerd roundtrips through a real
collector. Tests prove bounded admission/bytes, partial responses, transient retries,
deadlines, cancellation and close, plus business/readiness isolation during outage.
The jobs host opts in with explicit settings. Other protocols/signals, automatic
instrumentation and durable downstream storage guarantees remain separate work.

## Workers scheduled events implemented

[Managed work](application-work.md), [the adapter](workers-scheduled.md),
[invocation ownership](scheduled-invocations.md), [audit example](workers-scheduled-example.md),
[telemetry](scheduled-telemetry.md) and [native proofs](workers-scheduled-testing.md)
have separate guides. Actual workerd dispatch proves original metadata, shared
startup, concurrent admission, failures/noRetry, cooperative/ignored abort,
resource/export drain and close. The runnable example and independently installed
Workers starter consume real local triggers. The example's stable KV effects
survive the gate's persisted-namespace isolate restart; schedule/queue state does
not. Platform deployment and durable provider guarantees remain separate.

## Workers durable Object storage implemented

[SQL provider](workers-durable-sqlite.md), [transaction ownership](durable-sqlite-transactions.md),
[schema history](durable-sqlite-migrations.md), [queues](workers-durable-queues.md),
[atomic schedules](workers-durable-scheduler.md), [the report example](workers-durable-example.md)
and [native proofs](workers-durable-testing.md) each have a guide. The provider
borrows Object SQL through the existing Database contract, preserves async callback
rollback and rejects unsafe integer conversion. Existing SQLite stores retain
their claims/fencing and occurrence/cursor protocol; input gates prevent event
interleaving. Native workerd proves SQL/DDL rollback, concurrent clients, actual
Object-abort recovery, persisted work/results across host restart and the local
scheduled launcher. D1's separate batch capability is now implemented below;
it does not expose the Object provider's callback transaction contract.

## Workers queue events implemented

[Adapter](workers-queue-events.md), [decisions](queue-message-decisions.md),
[batch lifetime](queue-batch-lifecycle.md), [telemetry](queue-consumer-telemetry.md),
[receipt example](queue-worker-example.md) and [native proofs](workers-queue-testing.md)
each have a guide. Actual workerd preserves explicit partial ack/retry flags while
aggregating failed messages; batch/message limits and ignored-abort drain retain
resource ownership. The real local broker verifies redelivery/increased attempts
and dead-letter routing; its pinned explicit-ack redelivery limitation is documented
separately. The example publishes over HTTP and persists idempotent Object SQL
receipts without mirroring broker messages into SQL queue leases. Nothing deploys
cloud queues or promises local pending-delivery persistence.

## Durable Object alarms implemented

[Host](workers-sqlite-alarms.md), [atomic wakeup planning](alarm-wakeup-planning.md),
[schema](alarm-migrations.md), [recovery](alarm-recovery.md),
[automatic reports](alarm-report-example.md), [telemetry](alarm-telemetry.md) and
[native proofs](workers-alarm-testing.md) each have a guide. Queue/schedule mutations
and native alarm projection commit together through an optional Object SQL hook.
The clock includes pending/retry/lease deadlines and persisted failure backoff;
native callbacks process bounded batches and retain actual resource ownership.
Real workerd proves alarm-write rollback, Object reset before wakeup, interruption
after committed effect, lease recovery and chained backlog alarms. Cold local-host
startup needs one known-Object activation and a changed-time refresh; the launcher
does this explicitly. Managed cloud failover/deployment remains outside local QA.

## Atomic business writes and jobs implemented

[Typed API](transaction-publishing.md), [scope ownership](transaction-executors.md),
[SQLite](sqlite-transaction-publishing.md), [PostgreSQL](postgres-transaction-publishing.md),
[Object SQL](object-transaction-publishing.md), [task/report HTTP](task-report-transactions.md)
and [native proof](transaction-publishing-testing.md) each have a guide. The helper
uses the queue's existing schema/limits and transaction-store capability; exact
owner checks reject unsafe scopes. Providers join accepted preparation/insertion
before commit, expire callback/participant executors and reject commit after an
accepted publication failure even if caught. Existing schemas/payloads remain
unchanged. Native engines prove independent visibility, process interruption,
concurrent producers and Object business/job/alarm atomicity. Effects remain
at-least-once; external broker delivery is not made transactional by this API.

## Idempotent producer requests implemented

[API](idempotency.md), [JSON fingerprints](idempotency-json.md),
[ownership/retention](idempotency-storage.md), [SQLite](idempotency-sqlite.md),
[PostgreSQL](idempotency-postgres.md), [Object SQL](idempotency-workers.md),
[HTTP retries](idempotency-http.md) and [native proof](idempotency-testing.md)
each have a guide. Scope/key ownership, business writes, validated jobs and bounded
JSON results share one native transaction. Unexpired matching requests replay;
changed input conflicts. Expired keys can execute again; explicit bounded cleanup
does not remove business/job state. The task/report route optionally accepts a key
and preserves the original result/locations across hosts and restart. Native
process SIGKILL and Object resets prove before/after-commit behavior, with actual
alarms consuming one committed job. Queue effects remain at-least-once.

## External broker outbox delivery implemented

[API](outbox.md), [dispatcher](outbox-dispatcher.md), [SQLite/Object storage](outbox-sqlite.md),
[PostgreSQL storage](outbox-postgres.md), [retention](outbox-retention.md),
[Workers publisher](workers-outbox-publisher.md), [consumer IDs](outbox-consumer-deduplication.md),
[automatic pipeline](outbox-worker-example.md) and [native proof](outbox-testing.md)
each have a guide. Outbox composes the existing Queue engine under a dedicated
prefixed queue, preserving validated transaction writes, leases/fencing, retries
and actual publisher drain. Message IDs remain stable across ambiguous remote
acceptance; consumer effects dedupe them. Explicit cleanup is bounded and excludes
active records. Delivery retains existing PostgreSQL DML grants; trusted maintenance
uses separate DELETE capability. Native producer/dispatcher SIGKILL, actual broker
delivery IDs, Object alarm/reset and restarted local hosts prove the working path.
There is no external cross-system commit or exactly-once promise.

## Outgoing failure inspection and deliberate redelivery implemented

[Inspection](outbox-inspection.md), [retry](outbox-deliberate-retry.md),
[concurrency](outbox-recovery-concurrency.md), [migration upgrade](outbox-recovery-migrations.md),
[HTTP](outbox-operations-http.md), [authorization](outbox-operations-authorization.md)
and [native proof](outbox-recovery-testing.md) each have a guide. Explicit metadata
projection and queue/state keyset pages keep payloads/lease tokens private. A
conditional failed-to-pending UPDATE raises the observed ceiling, keeps attempts
cumulative and retains the same message ID/payload. Native races have one winner;
pruning never resurrects a message. Separate index lists preserve deployed history.
The example exposes opt-in authorized operations and native alarm projection.
Actual processes/Objects prove commit interruption, legacy upgrade, cleanup races,
real broker redelivery with one effect and HTTP authorization/cursor behavior.

## Durable recovery audit implemented

[API](outbox-audit.md), [schema/roles](outbox-audit-storage.md),
[attribution](outbox-audit-attribution.md), [history](outbox-audit-history.md),
[retention](outbox-audit-retention.md), [atomicity](outbox-audit-atomicity.md),
[HTTP](outbox-audit-http.md) and [native proof](outbox-audit-testing.md) each have a
guide. An optional audited retry commits actor/reason/result with its conditional
transition; valid conflicts/missing results also append events. Invalid input and
operational failures leave no event. History survives delivery pruning and has
independent bounded maintenance. The example binds a server service identity,
validates reason codes and rejects actor spoofing. Native SQL/Object interruption,
denied append, concurrency and minimal PostgreSQL maintenance privileges are proven.
The shared capability identifies a service credential holder, not an individual.

## Account authorization for operations implemented

[Transaction authentication](transaction-authentication.md), [PostgreSQL locking](postgres-transaction-auth.md),
[authorized retry](outbox-authorized-retry.md), [shared Hono routes](outbox-hono.md),
[account commands](account-operations.md), [trusted provisioning](operator-provisioning.md),
[runnable demo](operator-accounts-demo.md) and [native proof](operator-accounts-testing.md)
each have a guide. The optional PostgreSQL profile connects member-owned commands,
user-scoped idempotency, operator recovery and verified user audit IDs. Mutations
recheck sessions/roles under native locks through commit; read/replay admission
remains explicitly scoped. Role changes revoke existing sessions atomically through
trusted tooling, with no public operator registration or client actor claims.
The shared service-credential path remains available. Native PostgreSQL processes,
actual Object SQL and the real broker prove denial, lock ordering, rollback,
privileges, stable-ID effects and host cleanup. One deployment queue is explicit;
multi-tenant policies and database RLS remain separate capabilities.

## Persistent operator host implemented

[Bounded JSON transport](service-json-client.md), [bearer capabilities](bearer-capabilities.md),
[HTTP delivery](outbox-http-publisher.md), [receipt conflicts](receipt-deduplication-conflicts.md),
[durable receiver](http-message-receiver.md), [configuration](operator-host-configuration.md),
[receipt/readiness integration](operator-receipt-transport.md), [persistent host](persistent-operator-host.md)
and [native proof](persistent-operations-testing.md) each have a guide. The runtime
uses a user-provisioned PostgreSQL deployment and explicit protected receiver;
migration/provisioning credentials stay separate. The receiver acknowledges only
after deduplicated SQL effect storage. Native tests prove all four Fetch runtimes,
publisher SIGKILL after remote commit, actual lease recovery, secret rotation,
readiness during outage and commands/audit/receipts across both processes restarting.
The temporary broker demo remains separate; no local broker pending-delivery
persistence is assumed. Cloud failover and backup policy remain deployment work.

## Account command history implemented

[API](account-command-history.md), [upgrade](command-history-migrations.md),
[cursor semantics](command-history-cursors.md), [safe delivery projection](command-history-delivery.md)
and [native proof](command-history-testing.md) each have a guide. Owner-scoped
bounded pages and explicit operator/global scope use immutable int64 insertion
positions. Legacy commands remain; unambiguous retained deliveries backfill, while
unknown/pruned metadata stays unavailable. New command/association/outgoing writes
remain atomic and replay once. Native processes prove DDL rollback, concurrent
upgrade/writers, large positions, cursor traversal across restart, current roles,
and a metadata-only database role with payload/lease access denied.

## Web console and complete application implemented

The [console](web-console.md), [security](console-security.md),
[operator recovery](console-recovery.md), [design](console-design.md) and
[verification](console-testing.md) each have a guide. Real account APIs connect
history, create/detail, receipts and bounded operator inspection/retry/audit.
The browser gate proves lost-response replay, stale retry conflict, actual
consumer results and revoked-session clearing. Light/dark desktop/phone captures,
keyboard, scaled text and automated accessibility checks are verified; real-device
assistive technology remains manual. The [application walkthrough](command-application.md)
shows how developers run and adapt the same architecture.

## Independent application and local release hardening implemented

The [archive](command-app-distribution.md), [deployment profile](command-app-deployment.md),
[runtime grants](runtime-role-grants.md) and [native gate](command-app-testing.md)
connect editable application/receiver source to an independent framework snapshot.
Actual relocated installation/build, separate deployment credentials, browser use,
native receipts and outage/restart recovery are verified. [Offline restore](command-app-backup.md)
preserves sessions, roles, replay, commands, receipts and audit in fresh targets,
repairs function ACLs, reapplies minimal grants and processes a new command.
[Upgrades](command-app-upgrades.md), [runtime matrix](supported-runtimes.md) and
[CI](release-verification.md) document the operational boundaries.

## Hosted release review

[Draft PR #1](https://github.com/MirHamzaHasan/longhorn/pull/1) tracks the source
review branch and its actual hosted checks. The initial run passed source/runtime,
account-operation and browser jobs on Ubuntu, including 434 tests and the four
independent CLI starters. Current checks/logs remain authoritative for the current
head, including distribution/restore. [Locked dependencies](command-app-dependencies.md)
and [retained review artifacts](ci-review-artifacts.md) make the tested application
available for deliberate review before a tagged release. Cloud ingress/failover
and real-device assistive technology remain separate verification boundaries.
The [v0.1 plan](v0.1-plan.md) claims no merge, publication or production deployment.

## Buffered log export implemented

[Sink fanout](logger-sinks.md), [buffering](log-processing.md),
[log encoding](otlp-logs-json.md), [OTLP delivery](otlp-logs.md),
[reports/demo](jobs-logs-export.md) and [native proof](otlp-logs-testing.md)
connect synchronous logging to owned asynchronous export. Count/byte limits include
active work, overflow drops newest records, and final drain follows all application
producers. The reports host keeps full console output with an explicit remote
metadata projection and correlation to real spans. Native collector proofs cover
four runtimes, typed values, cancellation, ambiguous acknowledgement, overload and
business work through collector outage. Delivery remains best effort; durable
spooling and a complete OpenTelemetry SDK remain separate integrations.

## Workers D1 storage implemented

[Batch capability](batch-database.md), [guarded migrations](batch-migrations.md),
[native provider](workers-d1.md), [deployment ownership](d1-deployment.md),
[task API](d1-tasks.md), [atomic activity](d1-task-activity.md),
[exact cursor pages](d1-pagination.md) and [native proof](d1-testing.md) each have
a guide. Predeclared native batches preserve rollback without emulating callback
transactions. Read-only application startup follows a trusted schema phase. The
runnable retained local host verifies shared D1 task edits across workers, atomic
activity, wide integer cursors and restart. Decoder errors after commit remain
explicitly ambiguous; existing callback-based stores are not ported by this work.
Managed cloud deployment, replication/failover and D1-specific queue/auth protocols
remain later integrations. Predeclared request replay is implemented below.

## D1 batch request replay implemented

[Plans](batch-idempotency.md), [records/retention](batch-idempotency-storage.md),
[task HTTP](d1-idempotency-http.md), [upgrade](d1-idempotency-upgrades.md) and
[native proof](d1-idempotency-testing.md) each have a guide. Response, task and
activity commit in one native batch. Duplicate keys fail before business SQL and
read saved results. Positive evidence also recovers lost binding acknowledgements
and post-commit decoding failure without write replay. Actual HTTP socket loss,
cross-worker requests, expiry races, cleanup and retained restart are verified.
Existing callback APIs keep separate semantics. Task/activity pages now order by
qualified integer positions across decimal digit boundaries.

## Standalone D1 developer workflow implemented

[Template selection](d1-starter.md), [asset/source distribution](d1-starter-snapshot.md),
[owned development](d1-starter-development.md) and [native project proof](d1-starter-testing.md)
each have a guide. CLI builds bundle the existing D1 source and checked assets
with selected framework exports. Packed binaries generate an editable retained app
outside the checkout. Fresh/frozen installation, shipped native tests, actual CLI
host restart, compilation failure/recovery, source reload and schema/config startup
denial are verified. Default API starters remain the four-runtime profile;
cloud deployment and automatic upgrades remain separate.

## Standalone Node SQLite workflow implemented

[Profile selection](sqlite-starter.md), [shared assets](application-template-assets.md),
[lifetime](sqlite-starter-lifecycle.md) and [native proof](sqlite-starter-testing.md)
each have a guide. The actual Node task source/tests now generate independently
through packed binaries, with relative file overrides and native persistence QA.
Installed hosts prove concurrent writes, restart, integrity, environment precedence,
process-local observations and source watching. Startup failures preserve retained
state. D1 keeps its existing descriptor/output via the shared validator. Neither
profile adds automatic publication, upgrades or production account policy.

## Native Bun SQLite implemented

[Provider](bun-sqlite.md), [async ownership](bun-sqlite-transactions.md),
[shared statement boundaries](sqlite-statement-boundary.md),
[persistent tasks](bun-sqlite-tasks.md) and [native proof](bun-sqlite-testing.md)
each have a guide. Bun's native synchronous driver now implements the existing
Database interface with exact int64 values, input snapshots, bounded admission,
real async callback transactions and actual resource drain. Same-file handles
coordinate across awaits; lost native transaction ownership prevents later
autocommit through a caught rollback error. Existing queue/scheduler/replay stores
run unchanged. The task host shares Node's application/repository and persists
through real process restarts. Native gates prove lock contention, SIGKILL recovery,
participant failures and concurrent HTTP writers. SQL I/O remains synchronous;
distributed locking remains separate work. Native Deno persistence is implemented
below. An independent
Bun starter now uses this provider as described below.

## Independent Bun SQLite workflow implemented

[Runtime/profile selection](bun-sqlite-starter.md),
[owned development](bun-sqlite-starter-development.md) and
[installed proof](bun-sqlite-starter-testing.md) each have a guide. The existing
sqlite-tasks application now supports --runtime bun as well as Node. A fixed
internal asset variant preserves the public template identity and descriptor v1.
It snapshots actual shared source, Bun host/storage and adapted native tests,
without copying Node/Workers adapters. A Node/esbuild supervisor retains the old
host on failed compilation, drains serial replacements and stops on startup failure.
Packed binaries, relocation/frozen install, native source/persistence tests and
actual HTTP/watch/schema failure gates establish an editable independent app.
Production account policy, deployment and automatic upgrades remain separate.

## Bounded SQLite task reads and aggregate summaries implemented

[Cursor pages](sqlite-task-pages.md), [whole-collection counts](sqlite-task-counts.md)
and [retained read upgrades](sqlite-task-read-upgrades.md) each have a guide. The
shared Node/Bun/Redis task application now returns bounded keyset pages with exact
int64 cursors and optional completion filters. Summary loaders read one aggregate
row rather than materializing the entire collection. The original table migration
stays byte-identical; a new completed/id index is appended to the checked history.
Both independent SQLite variants ship the source, guides and adapted native tests.
The actual persistence gate traverses 1029 tasks, verifies both filters/counts and
handles a deleted cursor boundary. Live pages are not snapshot isolation, and
cross-host summary consistency still follows the selected cache TTL.

## Optional native Rust service implemented

[Native reports](rust-reports.md), [portable client](native-report-client.md),
[jobs selection](jobs-native-reports.md), [owned demo](rust-reports-demo.md) and
[native proof](rust-reports-testing.md) each have a guide. The native workspace now
builds a real authenticated loopback service from a locked Cargo graph. Report
computation remains pure and versioned; existing queue/SQL ownership stays in the
application. A typed Web Fetch client validates results and drains actual calls on
all four JavaScript runtimes. Jobs select it through DI, expose dependency readiness
and recover durable work after a native outage. A one-command demo computes and
persists a new report. Direct-child ownership is implemented below; arbitrary
plugin orchestration, native durable effects and production ingress remain
subsequent integrations.

## Owned native process lifecycle implemented

[Node process resources](managed-node-process.md),
[async computation acquisition](report-computer-resources.md),
[owned Rust integration](owned-native-reports.md),
[persistent host](native-jobs-host.md) and [proof](managed-process-testing.md)
each have a guide. The optional Node entrypoint owns one trusted direct executable
with explicit environment, bounded framing/output, startup cancellation and actual
exit/forced-stop reporting. Shared core and the portable client remain process-free.
The jobs app acquires computation after storage and releases it after accepted
queue/readiness work drains. The new host starts/probes Rust with random credentials
before HTTP readiness, retains SQLite across restarts, rolls back failed binds and
recovers durable attempts after native failure. Parent crash supervision,
descendant ownership and automatic restart remain host deployment concerns.

## Native Deno SQLite implemented

[Provider](deno-sqlite.md), [binding slots](deno-sqlite-bindings.md),
[callback ownership](deno-sqlite-transactions.md), [task host](deno-sqlite-tasks.md)
and [native proof](deno-sqlite-testing.md) each have a guide. The optional Deno
entrypoint implements the existing Database over its built-in node:sqlite.
Exact input/slot checks prevent omitted bindings from becoming native NULLs;
native all() preserves step failures that the pinned iterator can hide. Async
transactions retain canonical file ownership across awaits, join publishers and
fence a native automatic rollback. The shared task app runs with explicit Deno
file/network/environment grants and preserves tasks through native restart.
Actual tests cover permissions, contention, crash recovery, 1029-task bounded
reads/counts and Node/Bun/Deno writes to the same retained file with an int64 ID.
SQL calls remain synchronous. Independent Deno generation is implemented below;
deployment profiles remain subsequent work.

## Independent Deno SQLite workflow implemented

[Project selection](deno-sqlite-starter.md), [source/test mapping](deno-sqlite-starter-snapshot.md),
[launch permissions](deno-sqlite-starter-permissions.md),
[owned development](deno-sqlite-starter-development.md) and
[installed verification](deno-sqlite-starter-testing.md) each have a guide. The
same public sqlite-tasks profile now selects Node, Bun or Deno. Packed creation
ships actual editable source/tests, a selected local framework closure and frozen
installation. A Node launcher validates project environment settings and gives
native Deno literal-path named grants, joining child and policy-file cleanup.
Serial source replacements preserve old service on compile failure and retained
storage across success. Native tests/persistence, actual grant denial and installed
restart/schema recovery are verified. Production account/deployment policy and
automatic updates remain independent work.

## Native passwords and retained authentication implemented

The [shared scrypt policy](scrypt-password-policy.md) retains the original Node
wire format and actual-settlement queue ownership. Explicit [Bun](bun-passwords.md)
and [Deno](deno-passwords.md) native crypto entries now connect to the same
[auth application](native-auth-example.md), native SQLite and scoped host settings.
Private notes use [bounded owner pages](auth-note-pages.md) with the existing
index and unchanged migration SQL. Clients follow `nextCursor` instead of relying
on the previous unbounded list.

The [native gate](native-password-testing.md) proves independent raw crypto and
legacy/peer hashes, live event loops, real SIGTERM during accepted registration,
mixed three-host sessions/roles/revocation and more than 1000 owner-scoped notes.
Workerd still uses explicit test-only password drivers. Independent auth CLI
generation is implemented below; account recovery/reset and additional runtime/OS
evidence remain separate work.

## Independent native auth workflow implemented

The [sqlite-auth profile](auth-starter.md) generates Node, Bun or Deno projects
with actual editable auth source, native crypto/storage, eight copied app cases
and per-feature guides. [Checked assets](auth-starter-snapshot.md) retain descriptor
v1 and selected dependency closure. The [launcher](auth-starter-launcher.md) applies
the shared schema/environment policy and literal Deno grants; [development](auth-starter-development.md)
keeps service on compile errors and serially drains native replacements.
The [packed gate](auth-starter-testing.md) verifies relocated frozen installs,
native persistence, independent hashes, retained account/session policy and bounded
private notes, configured denial, source reload and schema restoration.

## Authenticated password changes implemented

[Service policy](password-changes.md) now requires a current session/password,
derives outside SQL and atomically replaces credentials while revoking subject
sessions. [Conditional issuance](password-session-fencing.md) prevents old verifiers
from issuing afterward, including current login-only SQL hosts. The
[SQLite port](sqlite-password-changes.md) retains its original schema; the
[PostgreSQL port](postgres-password-changes.md) appends two restricted functions
after the complete operations history without granting direct password UPDATE.
[HTTP routes](password-change-http.md) clear cookies on 204 and preserve peers/notes.

[Native proof](password-change-testing.md) covers stale/concurrent work, real lock
wait expiry, SQL rollback, four backend SIGKILL checkpoints, active KDF drain and
retained HTTP/generated projects. Every old login writer must be upgraded before
enabling mutations. Recovery/reset and MFA remain separate. The browser integration is recorded below.

## Browser account settings implemented

The [Account page](console-account.md) connects the existing password API to the
console and shipped application. Host capability, Unicode confirmation, live
reauthentication/session distinction, one pending mutation across navigation and
secret clearing are implemented. Success requires sign-in; uncertain responses
are explained and never replayed. The [browser proof](console-account-testing.md)
covers native revocation/throttling, dropped and late responses, the real deadline,
keyboard, both themes, phone widths and 58 account captures. The relocated
archive changes credentials through its shipped form after restore/regrant.

Recovery/reset, MFA, additional browser engines and physical-device assistive
technology checks remain future work.

## Authenticated session controls implemented

[Session controls](session-controls.md) now support ending other live sign-ins
while retaining the initiator, or ending all current live sign-ins. Optional
[SQLite](sqlite-session-controls.md) and [PostgreSQL](postgres-session-controls.md)
ports reauthenticate/check expiry after transaction ownership using the existing
schema and restricted capability. Strict [HTTP routes](session-controls-http.md)
connect native/generated apps to the [browser Account actions](console-session-controls.md).
Password/session controls share pending state, clear secrets and never replay
unconfirmed responses. [Native proof](session-controls-testing.md) covers real
concurrency/ordering, expiry, rollback, four pre-commit kills, mixed-host cookies,
58 account captures and both controls after independent restore/regrant/restart.

Per-device inventory/metadata, recovery/reset and MFA remain separate future work.

## Saved command reuse and displayed-account consistency implemented

[Run again](command-rerun.md) loads an admitted saved command into a review form,
then creates a distinct command/delivery on explicit submission. Source data stays
unchanged; current number limits, fresh request keys, edited/manual replay and
navigation cancellation remain in force. The [viewer check](console-viewer-binding.md)
also prevents stale tabs from using a newly switched cookie for private reads/writes,
without logging the other account out. [Native proof](command-rerun-testing.md) covers
actual distinct receipts, scope, malformed legacy JSON, source loading/cancellation,
reproduced account switching, 117 command/recovery/reuse/filter captures and the relocated
app copying a pre-checkpoint source after restore/regrant/restart.

## Delivery status history filtering implemented

[API filters](history-status-filters.md) find pending, running, delivered, failed
or unavailable commands within the existing owner/operator boundary. Compatible
v1 and status-bound [v2 cursors](history-filter-cursors.md) support live traversal.
Two appended [partial indexes](history-filter-migrations.md) preserve all previous
checksums and require owner maintenance deployment. The [console](console-history-filters.md)
resets pages on selection and isolates canceled continuations. [Native proof](history-filter-testing.md)
covers real queue transitions, DDL interruption/concurrency, saved cursors, restricted
grants, actual index plans, 117 command captures and filtering in the restored app.
Arbitrary text/payload search and automated history-list refresh remain separate work.

## Command delivery and receipt following implemented

[Command detail](command-live-updates.md) now checks boundedly for actual delivery/
receipt changes and stops automatically at terminal results. [Page lifetime](command-follow-lifecycle.md)
handles hidden/offline pause, generation fencing, time/check limits and navigation.
[Controls](console-command-follow.md) preserve focus and require explicit retry after
errors or limits. [Proof](command-follow-testing.md) covers native results, cancellation,
auth boundaries, 26 additional captures and the shipped independent application.
Server push, background synchronization and automatic recovery remain separate work.

## Selected command history export implemented

[History export](history-export.md) traverses the current owner/operator/status
selection through existing protected pages. [Versioned NDJSON](history-export-format.md)
uses bounded files with explicit continuation rather than silently truncating the
selection. [Page ownership](history-export-lifecycle.md) handles cancellation,
errors, timeout and fresh admission; [controls](console-history-export.md) keep
focus and expose continue/start over. [Native proof](history-export-testing.md)
checks actual downloads, a 10000-row segment plus its exact remainder, no secret
fields, authorization changes, 34 captures and the restored standalone application.
Snapshot exports and import remain separate protocols.
[Computed receipt export](receipt-export.md) is now implemented separately.
[Recovery audit exports](recovery-audit-export.md) are now implemented separately.

## Bookmarkable history views implemented

[Canonical filter fragments](history-view-links.md) now preserve scope/status
across reload and browser Back/Forward. [Navigation](console-history-navigation.md)
re-reads current pages, retains in-document return links and cancels old work.
[Validated sign-in return](history-view-sign-in.md) supports cold links, registration
and reactive expiry without accepting arbitrary destinations. Members following
operator views receive actual denial and an explicit own-scope action. [Proof](history-view-link-testing.md)
covers real accounts, invalid claims, canceled pagination, bookmarked export,
26 additional captures and restored shipped assets. Snapshot/scroll/cursor URLs remain separate features.
[Account-owned named views](saved-history-views.md) now persist separately.

## Command-ID prefix search implemented

[ID search](history-id-search.md) now combines case-folded UUID prefixes with
existing status/owner/operator history. [v3 cursors](history-search-cursors.md)
bind exact search context while preserving unsearched v1/v2. Two appended
[expression indexes](history-search-migrations.md) retain the complete previous
profile and runtime grants. The [console](console-history-search.md) supports
submit/clear, saved query links and canceled paging; [searched export v2](history-search-export.md)
identifies the narrowed selection. [Native proof](history-search-testing.md)
covers actual queue states, upgrade death/concurrency, restricted projection,
6000-row owner/global plans, 26 captures and restored standalone search/export.
Request-key, substring, arbitrary text/number and payload search remain separate work.


## Recovery audit export implemented

[Operator audit downloads](recovery-audit-export.md) now traverse all actions or one
delivery through existing fresh admission. Their [v1 file schema](recovery-audit-export-format.md)
preserves attributed retry snapshots, including all four outcomes and pruned
sources. A [shared bounded collector](bounded-page-export.md) and [page controls](console-audit-export.md)
reuse limits, exact continuation and cancellation with command exports. [Native proof](recovery-audit-export-testing.md)
covers 105 actual recovery requests, real files, role/session/viewer changes,
34 new captures and the independently restored application. [Computed receipt downloads](receipt-export.md) are now implemented separately.
Snapshot exports and import/restore remain separate protocols.


## Selected computed receipt export implemented

[Computed receipt downloads](receipt-export.md) now cover selected owner/operator/
status/search history and one fresh protected command. Their [v1 format](receipt-export-format.md)
preserves actual results and explicit not-found observations without raw inputs.
[Serial enrichment](receipt-export-lifecycle.md) keeps fresh admission, smaller
1000-command/ten-page bounds and whole-page continuation. [Controls](console-receipt-export.md)
cancel on changed contents and share page disposal with follow. [Native proof](receipt-export-testing.md)
covers actual broker effects, 1002 HTTP writes, exact retained continuation,
46 captures and restored standalone downloads. Snapshot export, import/restore
and further provider integrations remain separate work.


## Account-owned named history views implemented

[Named views](saved-history-views.md) now persist personal scope/status/search across
sessions and host restart. [Shared values](saved-view-values.md) feed [owner-only CRUD](saved-view-http.md),
[transaction/revision ownership](saved-view-concurrency.md), the appended [005 schema/grants](saved-view-migrations.md)
and the [native browser panel](console-saved-views.md). [Proof](saved-view-testing.md)
covers concurrent quota/edit races, real interrupted commits, changed sessions/roles,
54 new captures and the independently restored application. Sharing/team views,
public short links and further account-retention maintenance remain separate work.


## Opt-in expired request cleanup implemented

[Owned cleanup](idempotency-cleanup.md) now runs serial bounded batches through the
existing store/clock. [Shutdown](idempotency-cleanup-lifecycle.md) drains active SQL
and error observation before pool release. [Default-off host flags](request-cleanup-host.md)
reuse current ledger grants/readiness with no migration. [Retention](request-cleanup-retention.md)
remains logical and table-wide; live replies, business records and saved preferences
retain their existing policy. [Native proof](request-cleanup-testing.md) covers real
Node/Bun/Deno SQLite, restricted PostgreSQL, grant recovery, held replacements,
blocked shutdown and opt-in cleanup in the independently restored archive.
Business-data retention, cluster-wide scheduling and provider integrations remain
separate work.


## Complete command application CLI profile implemented

[command-app generation](command-project.md) now creates the full Node/PostgreSQL
console and separate receipt receiver through both existing CLI entrypoints. The
[shared checked snapshot](command-project-snapshot.md) also owns archive creation,
including actual source/tests, deployment/backup tools and feature guides. Creation
keeps database/receiver setup explicit; installation resolves the initial graph.
[Host script ownership](command-project-lifecycle.md) preserves direct native drain
and custom/hook pnpm behavior. [Packed verification](command-project-testing.md)
uses relocated installed packages and the complete actual SQL/browser/restore flow.
[Source-aware development](command-source-development.md) is now implemented below.
Automatic framework upgrades remain separate work.


## Command and receiver source development implemented

The [command source loop](command-source-development.md) now builds actual app and
console source together, reloads private profiles and preserves running output on
compile failure. [One build sequence](command-development-builds.md) fences latest
edits around [native close](command-development-lifecycle.md). A separate
[receiver watcher](receiver-source-development.md) retains its own storage/output.
[Installed proof](command-development-testing.md) covers real recursive edits,
SQL/HTTP held through reload, latest generations, replay/session/receipt persistence,
config failure, terminal cleanup and a forced stop reported as failure. Automatic
framework upgrades and multi-host orchestration remain separate work.


## Read-only operator preflight implemented

[Runtime checks](operator-preflight.md) now diagnose configuration, built assets,
PostgreSQL/schema/access, restricted role and protected receiver before serving.
[Report v1](operator-preflight-report.md) carries fixed private-safe observations.
[Shared readiness](postgres-application-readiness.md) keeps live startup/probes aligned;
[owned interruption](operator-preflight-lifecycle.md) drains admitted work and close.
[Native proof](operator-preflight-testing.md) covers actual archive/installed CLI,
failure/recovery, interrupted SQL and unchanged pending/expired/business state,
then checks the restored app. Owner migration checksums, exhaustive mutation grants,
production ingress and automated repair remain separate verification/actions.


## Request attempt limits implemented

[Portable budgets](request-limits.md) now connect [bounded memory](rate-limit-memory.md),
[managed SQLite/PostgreSQL](rate-limit-sql.md) and explicit [Hono routes](rate-limit-http.md).
[Owned drain](rate-limit-lifecycle.md) precedes borrowed database close. The
[default-off command policy](command-request-limits.md) shares accounts across
sessions/hosts and connects migrations/grants, startup/readiness/preflight and
retained backup state. [Native proof](rate-limit-testing.md) covers actual runtimes,
SQL contention, process death, upgrade races, HTTP denial and restored distributions.
Rolling/token-bucket algorithms, Durable Object SQL stores and scheduled bucket
maintenance remain separate work. Redis and D1 storage are implemented below.


## Redis request attempt storage implemented

[Redis budgets](redis-rate-limits.md) now use explicit [server-owned time](rate-limit-server-clock.md)
and one native script, while the existing memory/SQL clock callbacks stay valid.
[Deployment](redis-rate-limit-deployment.md) records noeviction, minimal ACL and
retained-state requirements. [Ownership](redis-rate-limit-lifecycle.md) drains a
borrowed connection through ambiguous post-commit failure without automatic retry.
A [protected API example](redis-rate-limit-example.md) computes real reports across
hosts and token rotation. [Native proof](redis-rate-limit-testing.md) covers actual
Redis contention/TTL/ACL, killed AOF recovery, HTTP outage and lost-reply shutdown;
other runtimes run the portable protocol with an explicit fake command client.
Redis cluster/failover and native Redis transports outside Node remain separate work.


## Native D1 request budgets implemented

[Atomic SQLite batch limits](batch-rate-limits.md) now supply the existing server-time
port through one native UPSERT/RETURNING. The [optional public task policy](d1-request-limits.md)
connects validation/replay, [appended schema](d1-limit-schema.md), complete deployment
verification and [HTTP/native drain](d1-limit-lifecycle.md). [Native proof](d1-limit-testing.md)
covers real D1 time, rollback/lost acknowledgement, bounded pruning, owner upgrade
races, two-worker quotas and packed/relocated CLI hosts with retained budgets.
Durable Object SQL stores, distributed edge deployment and scheduled maintenance
remain separate work.

## Subsequent framework modules

| Module | Depends on | Required proof |
| --- | --- | --- |
| Additional database integrations | Existing SQL contracts, configuration, DI, lifecycle | Provider-specific queries, schema changes, and shutdown behavior |
| Exporter/platform integrations | Observability and runtime lifetime contracts | Real collector/trigger behavior, bounded queues, shutdown/delivery policy |

Each implementation must add or update its own Markdown guide with APIs, package
dependencies, example integration, tests, and current limitations. Keep this roadmap
and the index honest when a milestone is implemented; do not mark scaffolds complete.
