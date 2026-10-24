# Owned Bun SQLite development reloads

Owner: [dev.mjs](../starters/bun-sqlite-tasks/dev.mjs), shipped with the
[Bun SQLite starter](bun-sqlite-starter.md). This Node/esbuild supervisor builds
the editable source graph and resolves the project's pinned Bun executable using
bun-runtime/package.json. Each host starts from the project directory.

Successful builds enter one serial replacement chain. The old host receives
SIGTERM; the supervisor awaits its real process close before starting the new
compiled module. The host's existing lifecycle drains HTTP, event observers and
cache work before releasing SQLite. There are no overlapping owned hosts during
replacement, live resource swapping or automatic SQL retries.

Compile errors report a failed build and retain the old listener. Corrected source
gets a new host with retained tasks and fresh process-local observations. Invalid
configuration/schema, a failed spawn or unexpected native exit stops development
with a nonzero result. Changing applied migration SQL cannot quietly create a new
history; restore it or add a reviewed upgrade.

SIGINT/SIGTERM stop admission, dispose the watcher, join any replacement and stop
the remaining host. Repeated signals share cleanup. A ten-second host-stop budget
can force SIGKILL, but reports cleanup failure; it is not claimed as a successful
drain. CLI signal forwarding retains its existing process-tree behavior.

The watcher is a generated project tool, independently editable. The repository's
`pnpm dev:bun-sqlite` remains a compiled example command. Bun's environment-file
behavior applies from the project cwd; relative database paths come from the
entrypoint's project directory. See [configuration](bun-sqlite-tasks.md),
[native lifetime](bun-sqlite-transactions.md) and [verification](bun-sqlite-starter-testing.md).
