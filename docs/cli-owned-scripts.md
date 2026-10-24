# CLI signals for generated script owners

Owner: `execute` in `cli/src/commands.ts`, used by both CLI entrypoints.
Generated `sqlite-auth` projects have Node parent scripts that already own their
native child and, for development, the esbuild watcher. Sending a signal to every
descendant and then that parent races the parent's native drain with a second
signal. Actual Node verification exposed an unsuccessful native exit after the
application had finished closing.

For `dev` and `start`, the CLI checks the project metadata and exact unchanged
script (`node dev.mjs` or `node start.mjs`). If the profile is `sqlite-auth` and
there are no corresponding pre/post script hooks, it runs the known owner directly
with the current Node executable. One forwarded SIGINT/SIGTERM reaches that owner;
its [launcher](auth-starter-launcher.md) retains the native child through actual
exit. The CLI waits for the owner and preserves its result.

The [command-app profile](command-project-lifecycle.md) also runs its unchanged
`node dist/operator-host.js` start owner and `node dev.mjs` source watcher directly
when the matching pre/post hooks are absent. The watcher owns a separate native
process group and [paired builds](command-development-builds.md).
Its installed real app workflow verifies ordinary owner shutdown and POSIX group
interrupt, with listener release and retained-state restart.

Other profiles, customized scripts, lifecycle-hook cases, build/test/typecheck and
installation retain the existing pnpm delegation/process-tree forwarding. This is
a specific generated-owner contract, not automatic inference that any arbitrary
script manages its descendants. No shell is introduced for direct owner execution.

On POSIX, auth native children have their own process group. A terminal group
interrupt reaches the parent/watcher while the parent signals and drains native
work once. The [packed gate](auth-starter-testing.md) separately proves installed
CLI close after reload and actual watcher-group SIGINT, including native stop,
clean owner exit and listener release. Windows signal behavior needs its own native
execution evidence. Parent crash/descendant supervision remains deployment-owned.

The [command-app check script](operator-preflight-lifecycle.md), exactly
`node dist/operator-check.js` without pre/post hooks, is another explicit owner.
Interruptions wait for admitted SQL/HTTP and pool close, preserving 130/143.
Customized/hooked checks and checks on other profiles retain pnpm behavior.
