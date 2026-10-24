# Deno runtime and owned development

The project installs pinned Deno 2.9.6 locally. pnpm start runs the Node start.mjs/host.mjs launcher, which validates project
configuration and starts that executable with dist/index.js and scoped grants. Deno.serve owns HTTP; LongHorn drains handlers, events and cache work
before SQLite cleanup. SIGINT/SIGTERM coalesce through app.close(). Node 20.19+
and pnpm 12.6.0 remain development tools, independently of the application runtime.

pnpm dev runs a Node/esbuild supervisor. A successful build serially stops the old
Deno host, awaits native shutdown and launches the new build from the project root.
Compilation errors retain the current host. Invalid config/schema or an unexpected
host exit stops development with failure. SIGINT/SIGTERM stop watching, finish any
owned replacement and drain the host. A host that fails to stop within ten seconds
is killed and cleanup reports failure; that is not a normal graceful shutdown.

The SQLite file survives reloads. Module memory, activity and summary caches reset.
Edits to applied migration SQL reject readiness; append an upgrade instead. There
is no hot replacement of live application resources, native Deno watch process or
cloud deployment. See [lifecycle](lifecycle.md) and [testing](testing.md).
