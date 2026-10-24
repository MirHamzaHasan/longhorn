# Configuration

src/config.ts defines APP_NAME (LongHorn), HOST (127.0.0.1), PORT (3000), LOG_LEVEL
(info), DATABASE_PATH (./data/longhorn.sqlite) and CACHE_TTL_MS (5000). PORT=0
selects an available port; :memory: selects temporary storage. Invalid settings
fail before opening a data directory or listener.

The Node launcher reads this project's .env then .env.local through Node's native
parseEnv, then overlays the six named process variables. It validates the same
compiled schema before choosing Deno permissions. Values are not copied into the
parent process environment. Only those application keys enter the child, with
Deno's own update check disabled. The Deno host validates its explicit snapshot
again; it never reads environment files or enumerates the environment.

Relative DATABASE_PATH resolves from the project for source and compiled hosts.
The launcher grants read/write to its parent directory (including SQLite sidecars),
network access to HOST, and reads of the six environment keys. :memory: gets no
filesystem grant. Per-launch named permission files hold literal path arrays,
including commas, and are removed after the child closes. Pinned Deno currently
labels named permission configuration experimental. These Node tooling scripts
are trusted project code, not a sandbox.

Environment files are read on each launch; changing them alone does not trigger
the source watcher. Restart development or trigger a source build to apply them.

Direct Deno launches from another cwd need explicit environment and permissions;
node start.mjs supplies the project policy from any cwd. The CLI --cwd path uses
that same launcher. See [runtime](runtime.md), [SQLite](sqlite.md) and
[testing](testing.md).
