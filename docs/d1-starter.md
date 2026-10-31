# Standalone D1 task starter

Owner: @longhornjs/cli template selection and the d1-tasks distribution assets.
Connects [project generation](project-generation.md), [D1 tasks](d1-tasks.md),
[source snapshots](d1-starter-snapshot.md), [development](d1-starter-development.md)
and [independent verification](d1-starter-testing.md).

```sh
pnpm create:app ../my-d1-api --runtime workers --template d1-tasks
cd ../my-d1-api
pnpm install
pnpm dev
```

The existing api template remains the default for Node/Bun/Deno/Workers. D1 tasks
requires explicit Workers selection; incompatible/unknown templates fail before
filesystem output. Both longhorn create and create-longhorn accept --template.
Programmatic createProject accepts template: 'd1-tasks'; CreatedProject reports
the selected template. The generated package records longhorn.template while
retaining schemaVersion 1 and normal CLI script delegation.

This profile supplies the actual editable task application, independent framework
exports/declarations, local D1 host, private deployment helper, build/watch tools,
source tests and native storage gate. The D1 graph
adds config/database/idempotency/runtime directly, without selecting Node database
drivers, memory-cache/event examples or background telemetry.

HTTP provides validated CRUD, revision conflicts, retained activity, exact numeric
cursor pages and optional request replay. Local data stays in data/d1. Each generated
feature has a guide under docs/features.md. Runtime bindings, deployment ownership,
public-data policy and retention remain explicit. See [task API](d1-tasks.md),
[replay](d1-idempotency-http.md) and [schema upgrade](d1-idempotency-upgrades.md).

The installed project works after relocation without this checkout. Keep
.longhorn/ and pnpm-workspace.yaml with it; install creates its own pnpm lockfile,
which can then be frozen. No public registry release, cloud resources, production
authentication or managed failover is supplied by generation.

[Task creation attempt limits](d1-request-limits.md) now append their own native
batch schema after the previous complete profile. Limits default off; complete
migration history still needs deployment. Actual starter source, policy guide and
opt-in native proof ship together. See [schema](d1-limit-schema.md) and
[installed verification](d1-limit-testing.md).
