# Native scheduled-event verification

Owner: [verify-worker-scheduled.mjs](../scripts/verify-worker-scheduled.mjs) and
[worker fixture](../scripts/fixtures/worker-scheduled.mjs). Connects the
[adapter](workers-scheduled.md), [budgets](scheduled-invocations.md),
[core work](application-work.md), [audit example](workers-scheduled-example.md)
and [telemetry](scheduled-telemetry.md).

```sh
pnpm test:worker-scheduled
pnpm test:projects
pnpm test:runtimes
```

Each command builds first. The focused gate uses actual local Miniflare
3.20250718.3/workerd 1.20250718.0, compatibility date `2025-07-18`, and Node 20.19+
tooling. Its browser-bundled fixture imports built package exports, not source
aliases. Native `Fetcher.scheduled({ cron, scheduledTime: Date })` creates the
platform controller/context and yields actual outcome/noRetry observations.

## Proofs

- Scheduled dispatch and Fetch share startup, preserve event metadata/bindings,
  and keep the application alive across invocations.
- Two I/O-held events occupy capacity; an overlapping third fails without retry
  suppression. Domain failures propagate; only explicit application noRetry is set.
- A controlled exporter keeps the event active until its real request completes.
- Cooperative budget abort fails the invocation. An ignored abort retains the
  slot/resources while adapter and core close concurrently; release precedes
  resource cleanup and later scheduled work is rejected.
- The compiled audit example runs its bounded schedule/queue pipeline and writes
  the stable KV key on replay. A new isolate with the same persisted test namespace
  sees the prior effect, starts with fresh invocation stats, and overwrites the same
  event key on replay. This does not assert durable queue/cursor state.
- Missing AUDIT fails with explicit noRetry. Consumer spans omit raw cron/job IDs.
- The standalone launcher receives a manual event through this pinned host's
  internal control endpoint, serves the audit, then drains/exits on SIGTERM.

Test-only raw state/close routes exist only in the fixture. Its close route bypasses
`app.fetch` to avoid shutdown waiting for its own request. The gate owns temporary
bundles/KV, I/O gates and child processes, releases held requests on failure and
disposes every owned host. It touches no normal example data or cloud account.

## Complementary checks

[Core work tests](../packages/core/src/work.test.ts) cover callback results/errors
and startup/shutdown races. [Adapter tests](../runtimes/workers/src/scheduled.test.ts)
cover registration identity, context method ownership, input/options, startup
budgets, capacity release and ignored cancellation without native timing dependence.

`test:projects` generates and relocates all four starters, installs their framework
snapshots independently and runs typechecks/tests/builds/native hosts/reloads. For
Workers it additionally dispatches the local scheduled event, verifies exact
metadata/counter observations and the consumer span. `test:runtimes` protects the
existing native listener/Fetch/background behavior. None of these checks imply a
deployment, production quota verification or guaranteed execution after eviction.
