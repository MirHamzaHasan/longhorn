# Project generation and framework snapshots

Owner: `@longhorn/cli` (`cli/src/generator.ts`, `cli/scripts/snapshot.mjs`).
The [CLI](cli.md) and `create-longhorn` call one generator implementation.
The output is an independent application, not another monorepo workspace.

## Programmatic API

```ts
import { createProject } from '@longhorn/cli'

const project = await createProject({
  directory: '../my-api',
  runtime: 'node', // node | bun | deno | workers
  name: 'my-api',  // optional; inferred from the destination otherwise
  template: 'api', // optional; d1-tasks: workers, sqlite-tasks: node
})
console.log(project.directory, project.runtime, project.packages)
```

Use the built package. `frameworkDirectory` can select a custom built snapshot
with the same manifest format; the standard CLI always uses its bundled snapshot.
Custom distributions are trusted local inputs, not downloaded plugins.

## Output and dependency resolution

```text
my-api/
  package.json             # Runtime, scripts, dependencies, LongHorn metadata
  pnpm-workspace.yaml      # Local dependency overrides and native build approvals
  src/                     # Application, host, tests, native configuration if needed
  build.config.mjs         # Selected target's esbuild options
  build.mjs                # Build entrypoint
  serve.mjs                # Workers local host only
  docs/                    # Feature index plus individual connection guides
  .longhorn/framework/     # Selected framework packages with dist/ and manifests
  .longhorn/README.md      # Snapshot ownership and update policy
```

LongHorn is still unpublished. The CLI build copies the implemented packages'
actual JavaScript, declarations, exports, and production dependency manifests into
its distribution. Internal `workspace:*` versions are replaced with actual package
versions. No repository source paths, node_modules, or development dependencies are
copied into framework packages.

Generation walks the selected starter's transitive `@longhorn/*` dependency graph
and copies only that graph. Direct dependencies and root pnpm overrides point to
`file:./.longhorn/framework/<package>`. Overrides cover transitive dependencies too,
so they resolve to the same snapshot rather than a registry package with that name.
This uses [pnpm's root override mechanism](https://pnpm.io/settings#overrides).
Third-party dependencies still install normally through pnpm; this is not a complete
offline package cache. The pnpm version remains 12.6.0 for every runtime.

Workers snapshots include the `@longhorn/workers/scheduled` JavaScript/declarations
and the core managed-work API. The generated host consumes that export directly;
its scheduled handler records isolate-local observations and awaits consumer
tracing. Separate generated guides explain managed work and scheduled events.
Native project verification triggers it after independent installation, alongside
the normal Fetch/reload checks. See [starter connections](starter-templates.md).

Keep `.longhorn/` and `pnpm-workspace.yaml` in version control. The generated project
can be moved before installation and does not require the original LongHorn checkout.
Framework updates require deliberate snapshot replacement; there is no automatic
updater or public release pipeline yet. Generated sources remain application-owned.

The [D1 task template](d1-starter.md) selects a separate application dependency
graph and editable source assets. Its [build snapshot](d1-starter-snapshot.md)
copies the actual example code and checks explicit asset hashes before staging.
Custom frameworkDirectory inputs selecting D1 must include templates/d1-tasks
assets. The package records longhorn.template and the API returns the chosen
template; default API package metadata remains compatible.
The [SQLite profile](sqlite-starter.md) reuses this same selection/staging flow
with Node application source, local environment files and its native persistence
test. Both persistent profiles use the [shared asset reader](application-template-assets.md)
while retaining their own runtime, required files, scripts and dependency closure.

## Filesystem behavior

The generator rejects non-empty directories, files, and symbolic-link destinations.
It creates all output in a temporary sibling directory, then renames the completed
directory into place. It checks the destination again before publishing output;
the rename cannot replace a non-empty directory. Failed copying removes staging
output. There is no `--force` option and no existing project merge behavior.

Parent directories may be created for a nested destination. They are left in place
if generation fails. A concurrent writer that makes the destination non-empty
prevents publication. Platform-specific filesystem errors propagate as failures.

## Verification

`cli/src/generator.test.ts` checks runtime selection, dependency closure, independent
copies, inferred/explicit names, empty destinations, existing content, symlink/file
rejection, failed-copy cleanup, and invalid inputs.

`pnpm test:projects` creates all four starters in temporary directories outside the
workspace, moves them to paths containing spaces, installs dependencies, typechecks,
tests, builds, runs actual hosts, checks HTTP and source reloads, and verifies cleanup.
The harness also installs local CLI archives, executes their package binaries,
checks successful automatic installation, and verifies that a failed installer
retains project files and its exit status. The verification never modifies
the normal example database or existing user projects.

Workers framework snapshots also contain the optional queue-event entrypoint's
JavaScript/declarations. The default starter keeps its existing Fetch/scheduled
host; adding broker bindings/consumer configuration is application-owned. See
[queue events](workers-queue-events.md) and the separate
[runnable producer/consumer example](queue-worker-example.md).

The snapshot also includes the optional SQLite alarm entrypoint, declarations and
internal provider commit composition. A starter does not acquire alarm ownership
without application schema/binding setup. See [alarm API](workers-sqlite-alarms.md)
and the [automatic report integration](alarm-report-example.md).

The CLI archive contains database/transactions and queue/transaction exports with
their declarations. Generated projects still select their runtime's dependency
closure; they do not automatically acquire SQL queues or transactional business
routes. See [transaction publishing](transaction-publishing.md) for provider/store
requirements and [the PostgreSQL application path](task-report-transactions.md).

The archive also contains [request idempotency](idempotency.md), including root,
SQLite and PostgreSQL JavaScript/declarations. The default starter selects its
existing dependency closure; enabling durable request replay requires explicitly
adding its store, complete migration history and application scope/key policy.

The archive also contains Outbox root/SQLite/PostgreSQL exports and the optional
Workers outbox publisher entrypoint with declarations. Default starters keep their
selected dependency closure and do not install a broker pipeline automatically.
Enabling one requires the [Outbox store/history](outbox.md),
[binding configuration](workers-outbox-publisher.md) and
[owned dispatcher/alarm](outbox-dispatcher.md).

Archived Outbox types/JS now include optional metadata pages and conditional
failed-delivery retry, plus separate SQLite/PostgreSQL recovery-index exports.
Applications append that feature history after their deployed migrations and
choose their own [operations authorization](outbox-operations-authorization.md).
The default starter does not acquire an operations credential or admin routes.

The same archived exports now include attributed retry, bounded audit history and
independent retention, with separate SQLite/PostgreSQL audit migration lists.
Applications explicitly deploy [audit storage/grants](outbox-audit-storage.md) and
supply [trusted identity policy](outbox-audit-attribution.md). No audit service or
credential is enabled merely by generating a starter.
