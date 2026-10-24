# Development process ownership and failure

Owner: command-app dev.mjs/dev-host.mjs and CLI execute. Connects
[source loop](command-source-development.md), [build admission](command-development-builds.md),
[CLI scripts](cli-owned-scripts.md) and [native proof](command-development-testing.md).

The watcher owns one build sequence and at most one native app or receiver child.
It starts the fixed role entry with the current Node executable, the project as
cwd and its runtime shell environment. The child remains responsible for typed
configuration, readiness and application resources. Structured lifecycle records contain
fixed messages, role/generation and cleanup-stage labels. Compiler errors retain
esbuild's normal source diagnostics; explicit application logging stays app-owned.

On reload, SIGTERM asks the current child to close. The owner waits for its actual
close event and a zero exit before publishing/starting another generation. In
POSIX development the child has its own process group, so a terminal interrupt
to the watcher does not independently interrupt native drain. Repeated parent
signals coalesce. Forced cleanup after ten seconds kills the owned child group
and reports failure; it never counts as a successful drain or permits a replacement.
SQL or external shutdown policies still belong to their existing resource owners.

SIGINT/SIGTERM stops new build admission, clears debounce, closes filesystem and
profile watches, awaits admitted builds and stops the native child. Build operations
are awaited rather than falsely canceled. A source error can recover in the loop.
An unexpected native exit, startup/config failure, watcher error, publication error
or failed old-child close stops the owner with a nonzero result. An error during
cleanup is reported even after shutdown was requested.

The installed CLI recognizes the unchanged command-app `node dev.mjs` script with
no predev/postdev hooks and forwards one signal to that owner. Existing fixed
start handling stays intact. Custom dev/start scripts and hook cases keep pnpm's
script environment and exit status. Receiver development uses its explicit
`pnpm dev:receiver` shell; the CLI does not invent shared credentials or start it
as an app side effect. Parent crash and production supervision remain deployment work.
