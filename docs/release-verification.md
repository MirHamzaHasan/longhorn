# Repeatable release verification

Owner: `.github/workflows/verify.yml` and the existing native gate scripts.
Connects [v0.1 scope](v0.1-plan.md), [runtime matrix](supported-runtimes.md),
[browser verification](console-testing.md) and [archive/restore proof](command-app-testing.md).

The workflow has read-only repository permissions, bounded jobs and no deployment,
publication or secret credentials. Ubuntu 24.04 jobs install pinned Node 20.19.4
and pnpm 12.6.0, use the workspace lockfile and build before checking types or
running compiled native fixtures. Source tests resolve workspace source so stale
compiled output cannot hide a regression. Build/typecheck must remain sequential
because package builds replace their declaration directories.

| Job | Required checks |
| --- | --- |
| Source and runtimes | Build, types, source tests, native Node/Bun/Deno/workerd, independent generic CLI starters |
| D1 storage | Actual local D1/workerd, batch/migration rollback, cross-worker revision/activity atomicity, exact int64 pages, retained process restart and local host cleanup |
| Redis cache | Owned Redis 7+ binary, existing memory-cache gate, shared codec/protocol on four runtimes and actual Node Redis/TLS/task HTTP integration |
| Telemetry | Pinned native Collector 0.163.2 Linux x64, real trace/metric/log JSON roundtrips on four runtimes, delivery faults and reports HTTP |
| Account operations | Native history upgrade/concurrency, transaction/account locks, persistent HTTP receiver/recovery |
| Browser | Installed Chromium, actual full workflow, axe, keyboard, themes/widths and real captures |
| Independent distribution | Relocated installed archive, native roles/schema, shipped HTTP flow, PostgreSQL 18 clients and offline restore |

The same scripts run locally after `pnpm build`. Browser jobs install Chromium
and its OS dependencies; distribution jobs compile checksum-pinned PostgreSQL
client tools for loopback QA. Native databases and processes are temporary and
owned by each gate. The workflow needs no shared PostgreSQL service or cloud account.
See [GitHub's Node workflow documentation](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).

The source is tracked on `codex/longhorn-v0.1` in the private
[LongHorn repository](https://github.com/MirHamzaHasan/longhorn), with
[draft PR #1](https://github.com/MirHamzaHasan/longhorn/pull/1) for review. The initial
[hosted run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40036764130)
provides actual Ubuntu evidence; source/runtimes, account operations and browser
jobs passed, including 434 tests and independently generated runtime starters.
The subsequent [distribution job](https://github.com/MirHamzaHasan/longhorn/actions/runs/40037309223/job/120699845875)
also passed its frozen installation, real app workflow and offline restore step;
its later upload failed on account storage quota. Those outcomes are distinct.
Use the PR's current checks and linked job logs for the exact head commit's
distribution/restore and overall result. An earlier green job never substitutes
for a failed or unverified current source revision.

The Redis feature is reviewed separately in [draft PR #2](https://github.com/MirHamzaHasan/longhorn/pull/2),
stacked on the v0.1 branch. Its first [hosted run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40040877740)
failed before any runner or step started. GitHub's check annotation says:
“The job was not started because an Actions budget is preventing further use.”
All five jobs therefore remain unverified on that revision in Ubuntu; this is
separate from the earlier artifact storage limit and the passing baseline run.
Local build, types, 449 source tests, the memory/Redis native gates and all four
generated starters passed. The workflow remains blocking; restoring hosted runner
availability and rerunning the current head is required before release.

Cumulative metric export is reviewed in [draft PR #3](https://github.com/MirHamzaHasan/longhorn/pull/3),
stacked on the Redis branch. Its first [six-job run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40042192327)
also failed before runner allocation, with the same Actions budget annotation on
the telemetry job. Local build/types, 464 tests, real collector trace/metric
interoperability across four runtimes, reports outage/recovery, the demo's normal /
interrupted startup and independent generic starters passed. The Linux collector
archive is checksum-pinned and the telemetry job is configured, but that is not
Linux execution evidence. Current PR checks must pass when runner use is available.

Buffered log delivery is reviewed in [draft PR #4](https://github.com/MirHamzaHasan/longhorn/pull/4),
stacked on metrics. Its first [hosted run](https://github.com/MirHamzaHasan/longhorn/actions/runs/40043462081)
failed all six jobs before any runner/step started. The telemetry check annotation
again identifies the Actions budget. Local frozen install/build/types, 480 tests,
native trace/metric/log collector gates, independent starters, archive/restore and
the log demo passed. Hosted validation remains a distinct required release gate.

D1 storage is reviewed in [draft PR #5](https://github.com/MirHamzaHasan/longhorn/pull/5),
stacked on logs. It adds the seventh job, using actual local D1 bindings without cloud
credentials. Local frozen install/build/types, 491 tests in 83 files, the native
D1 deployment/task/restart gate, Durable Object SQL regression, native runtimes
and all four independent generic starters pass. The D1 provider is an optional
batch capability; existing callback transaction stores keep their own gates.
Its [first hosted attempt](https://github.com/MirHamzaHasan/longhorn/actions/runs/40045777156)
failed all seven jobs before runner allocation or any executed step. The D1 check
annotation identifies the same Actions budget restriction. Hosted current-head
execution remains required independently of local evidence.

[Review artifacts](ci-review-artifacts.md) attempt to retain actual browser captures
and the application archive/checksum after successful independent verification.
Verification and upload availability are reported separately; the observed account
storage quota blocks hosted artifact creation, while local outputs remain available.
Successful uploads are private run outputs with bounded retention. A green hosted run and artifact review
are required before a tagged/published release. This workflow performs no registry
publish, tag, merge or production deployment, and does not prove cloud failover
or real-device assistive technology.
