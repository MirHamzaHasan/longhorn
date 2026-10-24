# Owned Deno SQLite development replacements

Owner: [dev.mjs](../starters/deno-sqlite-tasks/dev.mjs), composing the existing
Node/esbuild build loop with the [configured Deno launcher](deno-sqlite-starter-permissions.md).
It compiles the host and configuration entrypoints from the editable project.

Successful builds enter one serial replacement chain. The old native host receives
SIGTERM and must actually close before new configuration is read and another
child starts. HTTP, events, caches and SQLite drain through the real application.
Compile failure keeps the old listener; corrected source gets a fresh process
over retained storage. There is no live resource swap or overlapping owned hosts.

Invalid configuration/schema, failed spawn or unexpected child exit stops
development with failure. Startup validates the current compiled schema, so source
configuration changes refresh before choosing grants. Applied migration changes
cannot silently replace checked history. Environment files load on each launch,
but edits to them alone do not trigger source watching.

SIGINT/SIGTERM abort pending launch, dispose the watcher, join the replacement
sequence and stop the remaining child. Repeated shutdown shares cleanup. A
ten-second host stop can escalate to SIGKILL and still reports failure; actual
close and permission-file removal remain awaited. The CLI retains its process-tree
signal forwarding. A separately managed parent crash is outside this lifetime.
See [snapshot mapping](deno-sqlite-starter-snapshot.md),
[native callback ownership](deno-sqlite-transactions.md) and
[verification](deno-sqlite-starter-testing.md).
