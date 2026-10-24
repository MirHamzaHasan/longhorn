# Development CLI

Owner: `@longhorn/cli`, with `create-longhorn` as the creation-only entrypoint.
Both are Node development tools; generated applications select their own runtime.
Core and the runtime adapters never import the CLI.

## Commands

From the LongHorn checkout:

```sh
pnpm create:app ../my-api --runtime node
# Or: --runtime bun, deno, workers
cd ../my-api
pnpm install
pnpm dev
```

`create:app` builds the generator and its framework dependencies first. A destination
must be absent or empty, including hidden files. Runtime selection is required.
`--name my-api` overrides the name inferred from the destination. Names start with
a lowercase letter and contain up to 64 lowercase letters, digits, and hyphens.
`--install` runs pnpm after creation; a failed install retains the generated files
and returns the install exit code so it can be retried.

`--template api` is the default. Choose `--runtime workers --template d1-tasks`
for the [standalone persistent D1 app](d1-starter.md). Choose `--runtime node --template sqlite-tasks`
for the [local Node SQLite task app](sqlite-starter.md), or `--runtime bun --template sqlite-tasks`
for [native Bun SQLite](bun-sqlite-starter.md). Fixed application profiles reject
incompatible runtimes; both creation entrypoints share these options.

Choose `--runtime node|bun|deno --template sqlite-auth` for the
[native auth project](auth-starter.md). It ships editable account/session/private-note
source, native passwords/SQLite, source tests, persistence checks and owned reloads.
Its unchanged launch scripts use [single-owner signal forwarding](cli-owned-scripts.md);
custom scripts retain the generic pnpm path.

After building, the direct entrypoints are:

```sh
node cli/dist/bin.js create ../my-api --runtime node
node create-longhorn/dist/bin.js ../my-api --runtime node
node cli/dist/bin.js --help
node cli/dist/bin.js --version
node cli/dist/bin.js typecheck --cwd ../my-api
node cli/dist/bin.js test --cwd ../my-api
node cli/dist/bin.js build --cwd ../my-api
node cli/dist/bin.js start --cwd ../my-api
node cli/dist/bin.js dev --cwd ../my-api
```

`pnpm longhorn <arguments>` is a repository shortcut to the built CLI. Package bin
names are `longhorn` and `create-longhorn`; they are included in local package
archives. These packages have not been published, so no public `npx` availability
is implied. See [project generation](project-generation.md) for distribution.

Script commands require `longhorn.schemaVersion: 1` and a supported runtime in the
project's package.json. They execute the corresponding project script through
`pnpm run`, in that project's working directory. Unknown options, duplicate options,
extra positional values, missing scripts, and unrelated directories fail with a
nonzero exit. The CLI forwards interrupt/termination requests while awaiting the
child. On Unix, it signals the selected process subtree, including native watchers
that use separate process groups; application cleanup remains host-owned. Repeated
requests are coalesced while shutdown is in progress. Windows uses process-tree
termination and still needs native CI coverage.

## Connections

```text
create-longhorn binary -> @longhorn/cli argument handling -> createProject()
  -> selected template + bundled built framework snapshot -> independent project
longhorn build/dev/start/test/typecheck -> project scripts -> selected runtime host
```

`cli/src/commands.ts` owns parsing and process delegation. It does not launch a
server itself or reinterpret the application lifecycle. The CLI's build depends
on all implemented framework/runtime packages so its distribution snapshot is
created after their JavaScript and declarations exist.

## Verification and limits

`cli/src/commands.test.ts` covers parsing, fixed command delegation, help/version,
project checks, and exit status. `pnpm test:projects` invokes both built entrypoints,
installs fresh projects, runs their checks and HTTP hosts, edits source to verify
watching, and checks shutdown. See [starter templates](starter-templates.md).

The persistent sqlite-tasks template supports Node, Bun and
[Deno](deno-sqlite-starter.md). Its Deno variant has independent
[native install/watch/permission verification](deno-sqlite-starter-testing.md);
Workers keeps the d1-tasks profile. These choices do not alter the default api app.

The initial CLI supports creation and existing project scripts. Feature generators,
automatic framework upgrades, plugin installation, interactive prompts, deployment,
and multi-process orchestration are not implemented. Native execution is verified
on the current macOS host; Linux and Windows CI coverage remains future work.

Choose `--runtime node --template command-app` for the [complete command project](command-project.md),
including the actual PostgreSQL console, receiver, deployment and backup tools.
Creation prints setup instructions; database and receiver configuration are explicit.
Its [fixed start owner](command-project-lifecycle.md) preserves custom/hook pnpm behavior.

The unchanged command-app dev script now selects its [source owner](command-source-development.md)
directly, with one forwarded signal and actual native drain. Receiver development
uses the generated app's separate pnpm dev:receiver script and receiver shell.

`longhorn check --cwd DIRECTORY` runs a supplied project check script. The
[command-app profile](operator-preflight.md) supplies its native read-only diagnostic
owner, with one forwarded signal and final JSON after close. Other profiles keep
normal pnpm delegation and report a missing script unless the app defines one.
