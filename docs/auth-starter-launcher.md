# Configured native auth launching

Owner: generated `host.mjs`/`start.mjs`, from `starters/sqlite-auth`.
One Node parent supports the selected native runtime. It reads project `.env`,
`.env.local`, then defined process values for exactly seven app keys: `HOST`,
`PORT`, `AUTH_ORIGIN`, `AUTH_COOKIE_SECURE`, `SESSION_TTL_SECONDS`, `DATABASE_PATH`
and `LOG_LEVEL`. The actual compiled schema is loaded fresh for each acquisition.
Invalid fields are reported by name without input values and before native spawn
or data-directory creation. The application itself validates origin/cookie policy
before acquiring SQL. Other parent environment values are not forwarded.

Native hosts use their original environment readers, with these selected values
as process overrides. Defaults and data paths therefore remain those of the
[shared auth app](auth-example.md). Paths resolve against the project rather than
the caller's shell directory. `pnpm start` uses a compiled host; build first.
The Node binary is the tooling process executable. Bun 1.4.4 and Deno 2.9.6 are
explicit pinned development dependencies for their generated profiles.

For Deno, validated hostname grants network access; only the seven app keys receive
environment access. A persistent database receives read/write grants to its parent
directory, including required SQLite sidecars. `:memory:` receives no data grants.
Unique mode-0600 permission JSON files use literal path arrays, so spaces and
commas do not become CLI separators. The pinned runtime labels named permissions
experimental. No allow-all, FFI or subprocess grant is added.

The parent removes a Deno policy after actual child close, including failed spawn.
Signal cancellation during acquisition releases owned state; graceful close waits
for actual native exit, escalates after ten seconds and reports forced/nonzero
termination as failure. Native Node/Bun are not sandboxed by this launcher.
Parent crash/SIGKILL, supervision and remote ingress remain deployment-owned.
Native children have their own POSIX process group; the parent remains referenced
and owns their signals/actual exit. The CLI recognizes unmodified auth owner scripts
without lifecycle hooks and forwards only to that owner. Custom scripts use the
generic CLI process-tree policy and must establish their own ownership.
The [installed gate](auth-starter-testing.md) checks real configured Deno grants,
outside writes/env/run/network denial, environment precedence and cleanup.
