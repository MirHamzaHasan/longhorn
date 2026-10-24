# Startup, development and drain

Owner: `host.mjs`, `start.mjs`, `dev.mjs` and the application resource hooks.
`pnpm build` compiles editable source. `pnpm start` validates current configuration
and owns one compiled native child through actual exit. Startup failure propagates
a nonzero exit; owned shutdown escalates only after its budget and reports forced
termination as failure. This launcher does not supervise descendants or restart
a crashed child automatically.

The unchanged generated dev/start commands without pre/post hooks are recognized
by the CLI and run as direct Node owners, receiving one forwarded signal. Other
scripts retain pnpm delegation. On POSIX the native child has its own process
group, so terminal signals reach the parent, which performs the native drain.

`pnpm dev` uses Node/esbuild to watch source for all three runtime profiles.
Successful compilation serially drains the old host before replacement. A compile
error keeps the prior running app. Each launch reloads the compiled schema and
environment settings. A failed native replacement ends development with a nonzero
status. Environment files are read on launch; changing one alone does not trigger
source recompilation, so edit source or restart development to apply it.

The app validates origin/cookie configuration before SQL acquisition, opens the
native database, applies [checksummed migrations](migrations.md), registers auth
through DI and binds HTTP. A startup failure rolls resources back. SIGINT/SIGTERM
close the listener and drain accepted request/native password work before closing
storage. Repeated shutdown joins the same close. Signals during parent startup
cancel owned acquisition and join it; parent SIGKILL is outside graceful cleanup.
