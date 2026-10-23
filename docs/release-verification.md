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

This local directory has no Git history. The connected private
[LongHorn repository](https://github.com/MirHamzaHasan/longhorn) contains its initial
license; the implementation is being prepared as a review branch/draft PR there.
The workflow has been authored and locally validated. A hosted green run is required
before a tagged/published release; local results do not establish Linux runner
support or cloud deployment. Screenshots and package archives are local ignored
artifacts; no registry publish, tag or deployment is performed by this workflow.
