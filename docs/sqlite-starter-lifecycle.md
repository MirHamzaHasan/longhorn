# SQLite starter configuration and resource lifetime

Owner: copied src/index.ts, storage.ts, task-cache.ts and task-events.ts.
Connects [Node configuration](configuration.md), [SQLite](sqlite.md),
[application lifetime](lifecycle.md), [events](task-events.md) and [cache](task-cache.md).

The source and compiled hosts read project .env then .env.local, followed by
defined process values. Typed validation completes before database/listener startup.
DATABASE_PATH resolves from the entrypoint's project root, independent of cwd;
PORT=0 reports the actual bound URL. Invalid settings create no data directory.

Startup opens/migrates SQLite, acquires the summary cache and subscribes task
observers. The listener starts only after those hooks succeed. Shutdown drains
HTTP, then events, cache loads and database. A failed bind or schema-history mismatch
releases acquired resources. Existing application tests exercise these boundaries
inside the generated project too.

pnpm dev uses native tsx source watching; pnpm build plus pnpm start uses the same
configuration/database path with compiled code. Source reload can select another
ephemeral port; read the newest listening record. Restart after environment-file
changes. Signals use the existing application drain and CLI subtree forwarding.

SQLite coordinates concurrent local writers; committed tasks survive process
restart. Task events remain after-commit observations in the producing process,
and /activity resets on restart. Observer failure does not undo committed SQL.
The bounded memory cache invalidates local writes; external writes are visible
to direct reads immediately and to a summary after its TTL. Generation fences
are local, without distributed invalidation. These boundaries are demonstrated
by [the installed gate](sqlite-starter-testing.md).
