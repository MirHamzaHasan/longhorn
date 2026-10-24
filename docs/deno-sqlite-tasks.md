# Persistent tasks on Deno SQLite

Owner: [examples/deno-sqlite](../examples/deno-sqlite/src/index.ts). This host uses
the existing Node/Bun task application, repository, schemas, events, cache and
migration manifest. Only native storage and host/environment/signal wiring change.

```sh
pnpm install --frozen-lockfile
pnpm dev:deno-sqlite
curl -i http://127.0.0.1:3017/tasks \
  -H 'Content-Type: application/json' -d '{"title":"Keep this on Deno"}'
curl http://127.0.0.1:3017/tasks
```

The root command builds the example/dependencies and runs pinned Deno with
loopback networking, six named environment keys and read/write access only to
examples/deno-sqlite/data. No subprocess or FFI grant is needed. The default
SQLite path is data/longhorn.sqlite relative to this example, regardless of launch
directory. PORT defaults to 3017. APP_NAME, HOST, PORT, LOG_LEVEL, DATABASE_PATH
and CACHE_TTL_MS use the shared schema; absent environment keys preserve defaults.

For a different data directory, run the built entrypoint with read/write grants
for that directory and set DATABASE_PATH explicitly. A non-loopback HOST also
requires a matching network grant. The root command deliberately keeps its fixed
development permissions. Deno owns environment-file behavior; the host does not
read .env files itself or enumerate the entire environment.

[Storage startup](../examples/deno-sqlite/src/storage.ts) acquires the Deno database,
applies the existing checksummed task manifest and registers the Database/store
through DI. Startup failure closes the connection before rejecting. HTTP/event/
cache work drains before storage release. SIGINT/SIGTERM share one app-close
promise; close failure sets the host exit code to 1. No Native Rust process starts.

The existing API supports validated CRUD, exact int64 string IDs,
[bounded cursor/filter pages](sqlite-task-pages.md), [SQL counts](sqlite-task-counts.md),
process-local activity and TTL-limited summary caching. Tasks persist; activity
resets on restart and cache state belongs to each host. Node/Bun/Deno can read the
same local SQLite format and checked schema. Concurrent processes use native
SQLite locks; they do not share events/cache or an in-process gate.

This is the public local example with the same policy as basic/Bun tasks, without
account authentication. [Independent Deno projects](deno-sqlite-starter.md) now
ship this application through the CLI with their own configured launcher;
existing Node/Bun profiles retain their choices. See
[provider](deno-sqlite.md), [callback ownership](deno-sqlite-transactions.md),
[bindings](deno-sqlite-bindings.md) and [actual native proof](deno-sqlite-testing.md).
