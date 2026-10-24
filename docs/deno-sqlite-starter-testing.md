# Independent Deno SQLite project verification

Owner: [verify-sqlite-project.mjs](../scripts/verify-sqlite-project.mjs), now
parameterized by node/bun/deno while retaining Node as default.

```sh
pnpm test:deno-sqlite-project
```

The gate compares copied shared source and checked Deno host/storage adaptations,
packs both CLI binaries, installs them in an unrelated consumer and creates through
the installed creation binary with automatic dependency installation. It relocates
the app, freezes the lockfile, checks the Deno-only runtime closure and runs the
installed CLI's typecheck/test/build commands. Native Deno executes all 47 copied
application cases across six files with real assertions/mocks and actual SQLite.

The shipped persistence test uses native Deno.Command status to verify child
shutdown/output drain, retained CRUD, concurrent writers, checked migration history,
integrity and 1029-task bounded traversal/filter/count behavior. It owns temporary
storage and joins its children before cleanup. This is separate from the
[provider crash/permission gate](deno-sqlite-testing.md).

Installed hosts prove .env/.env.local/process precedence, a comma-containing data
directory, source-independent project-relative paths from another cwd, two native
writers, local-only observations and TTL-bounded summaries. A native probe uses
the live launch's permission file to verify selected-data access and denial of
outside writes, unrelated environment, another host and subprocess permission.
Normal/test/failed launches leave no policy files.

Development intentionally breaks compilation to retain the old listener, fixes
source to replace/drain it with retained tasks and checks CLI signal shutdown.
Invalid configuration creates no directory; changed applied migration SQL fails
readiness/development and restored source reopens retained state. Native OS/runtime
support, source tests and hosted exact-head results are recorded separately.
See [profile](deno-sqlite-starter.md), [mapping](deno-sqlite-starter-snapshot.md),
[permissions](deno-sqlite-starter-permissions.md) and
[development](deno-sqlite-starter-development.md).

## Local evidence

On macOS ARM64 with Node 20.19.4/pnpm 12.6.0 and Deno 2.9.6, frozen workspace
install, full build/type checks and 535 source tests in 87 files passed. The packed,
relocated Deno project passed 47 native cases, shipped persistence and installed
HTTP/config/permission/watch/schema recovery checks. Existing Node/Bun SQLite
projects, packed D1 project, all four generic API projects, the native Deno storage
gate and native runtime gate passed. Documentation validation checked 349 Markdown
files/3023 local links and preserved the original LICENSE blob. Hosted exact-head
CI remains separate evidence from these local results.
