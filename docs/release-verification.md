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
Use the PR's current checks and linked job logs for the exact head commit's
distribution/restore and overall result. An earlier green job never substitutes
for a failed or unverified current source revision.

[Review artifacts](ci-review-artifacts.md) retain actual browser captures and the
application archive/checksum after successful independent verification. They are
private run outputs with bounded retention. A green hosted run and artifact review
are required before a tagged/published release. This workflow performs no registry
publish, tag, merge or production deployment, and does not prove cloud failover
or real-device assistive technology.
