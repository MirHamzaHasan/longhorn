# Native PostgreSQL background verification

Owner: scripts/verify-postgres.mjs, fixtures/postgres-background.mjs and the Node/app
.postgres.test.ts suites. Connects [owned native clusters](postgres-local.md),
[queue storage](queue-postgres.md), [schedule dispatch](scheduler-postgres.md) and
[HTTP reports](postgres-reports.md).

Run pnpm test:postgres. It builds production outputs and creates a temporary real
PostgreSQL cluster with separate owner/runtime passwords. Tests refuse to run
against an implicitly selected external database. The native gate now covers:

- Pooled competing claims, locked-row skipping, delays, retries, token fencing,
  lease renewal, bounded final-attempt recovery and caller transaction rollback.
- Concurrent immutable registration, latest/catch-up/once/UTC-cron behavior,
  locked cursor skipping, cancellation races and inserted-job/cursor rollback.
- Two real consumer processes sharing 24 jobs, persisting one effect per job.
- SIGKILL during a claimed handler and after its SQL effect committed but before
  acknowledgement; recovery retries only with remaining attempts, fences old tokens,
  and preserves the effect through its primary-key idempotency boundary.
- Two dispatcher processes advancing a shared 20-occurrence backlog without duplicate
  IDs, and SIGKILL after job insertion before cursor advancement; both writes roll
  back, and a later tick recovers the same occurrence once.
- Restricted-role report endpoints, private-field omission, scoped counts, immutable
  schedules, validation, idempotent effects and denied unnecessary privileges.
- A producer with timing/worker disabled registers a real-time schedule, shuts down,
  and restarts with both enabled; the persisted definition yields a completed report.

Synthetic-clock schedules are cancelled before real-clock HTTP hosts start, so test
timestamps do not create an artificial multi-decade catch-up backlog. Barriers align
competing processes before work starts; forced kills target only owned fixture PIDs.
Finally blocks close pools/children and remove only the owned cluster directory.

Normal pnpm test remains database-independent and checks wrong-dialect rejection;
the dedicated native suite exercises PostgreSQL SQL and isolation rather than mocks.
Current engine/platform proof is PostgreSQL 18.4 on macOS ARM64. These checks do not
prove remote failover, poolers, production throughput or external-effect exactly-once
delivery. Rerun the native gate on any added backend/platform before claiming support.
