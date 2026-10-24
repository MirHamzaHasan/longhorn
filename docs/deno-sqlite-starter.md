# Independent Deno SQLite projects

Owner: the CLI SQLite profile and [Deno task source](deno-sqlite-tasks.md).

```sh
pnpm create:app ../deno-tasks --runtime deno --template sqlite-tasks
cd ../deno-tasks
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Both creation binaries and createProject support Deno under the existing public
sqlite-tasks template. Metadata stays runtime deno/template sqlite-tasks.
deno-sqlite-tasks is only an internal trusted asset directory. Node/Bun keep their
profiles; Workers selects d1-tasks. The four-runtime api profile remains default.

The independent project owns editable app/repository/schema/events/cache source,
a relative framework snapshot, feature guides and the original MIT license. Its
closure includes Deno/database/shared packages and excludes Node/Bun/Workers
adapters. Node 20.19+/pnpm 12.6.0 run tooling; pinned Deno 2.9.6 runs the application
and native tests. The local Deno binary and esbuild have explicit build approvals.

Source follows the [checked snapshot mapping](deno-sqlite-starter-snapshot.md).
The copied host defaults to port 3000, retains data/longhorn.sqlite and uses the
same immutable task manifest, exact IDs, bounded pages, aggregate summaries,
events and cache. The [launcher policy](deno-sqlite-starter-permissions.md) validates
project environment files/settings, starts Deno with scoped grants and joins it
on shutdown. pnpm build/start use that policy; pnpm dev adds
[ordered replacements](deno-sqlite-starter-development.md).

pnpm test runs all six actual application test files in Deno after compilation;
pnpm test:persistence exercises native files and real separate HTTP hosts.
[Installed verification](deno-sqlite-starter-testing.md) proves the packed project
after relocation/frozen installation. Native SQL is synchronous; the public task
app does not add accounts, request replay, revision checks, automatic upgrades or
deployment policy. Keep .longhorn/ and pnpm-workspace.yaml with the project.
