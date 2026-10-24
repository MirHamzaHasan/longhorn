# Independent native Bun SQLite projects

Owner: CLI SQLite profile, asset builder and the existing Bun task example. Select
the SQLite application and Bun runtime independently:

```sh
pnpm create:app ../bun-tasks --runtime bun --template sqlite-tasks
cd ../bun-tasks
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Both creation binaries and createProject support this combination. Metadata stays
`{ runtime: 'bun', template: 'sqlite-tasks' }`; bun-sqlite-tasks is an internal asset
directory, not another public template. Node retains its existing variant. Deno
and Workers SQLite combinations reject before filesystem output; Workers has the
separate D1 profile. The four-runtime api template remains the default.

The independent project owns editable task source, a built framework snapshot,
relative file overrides, feature guides and an unchanged MIT license. Its framework
closure contains Bun and the shared database package, without Node/Workers adapters.
Node 20.19+/pnpm 12.6.0 run development tooling; pinned local Bun 1.4.4 runs the app
and tests. Native build approvals include esbuild and Bun.

The builder copies the real shared task app/repository/configuration/events/cache
and the real Bun host/storage wiring. Two/four checked relative imports become
project-local paths. Node/Redis hosts are excluded. Six existing application test
files are adapted to native bun:test and the Bun listener; cache mocks keep Bun's
actual APIs with explicit type assertions replacing Vitest's type-only helper.
The native persistence gate is adapted from the existing Node gate. Checked mapping
counts reject source drift for review. [Shared asset validation](application-template-assets.md)
keeps descriptor version 1, path/hash/UTF-8/byte checks and atomic publication.

The app uses [native Bun SQLite](bun-sqlite.md), Hono/DI, exact decimal IDs and the
existing immutable task migration. It exposes task CRUD, /health, process-local
/activity and derived /summary. Default data lives in project data/longhorn.sqlite.
Relative data paths stay project-relative from source or compiled hosts. Bun owns
environment-file loading from the host working directory; CLI scripts/watchers
launch from the project. Direct launches elsewhere should supply environment values.
No Node dotenv policy is inferred.

`pnpm build` compiles the host and `pnpm start` runs it. `pnpm dev` uses
[owned development](bun-sqlite-starter-development.md). `pnpm test` runs native
application tests; `pnpm test:persistence` runs real separate Bun hosts against
temporary files. See the [independent project proof](bun-sqlite-starter-testing.md).

Native SQL remains synchronous. The basic task list/summary is unpaginated and
subject to the provider's default 1000-row limit. Activity/cache reset per host,
and another host's writes reach cached summaries after TTL. This public example
does not add account isolation, revision checks, request-key replay, deployment,
automatic framework updates or automatic schema upgrades.
