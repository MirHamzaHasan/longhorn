# Generated command host script ownership

Owner: execute in cli/src/commands.ts and the generated operator-host.ts.
Connects [profile](command-project.md), [existing CLI signal policy](cli-owned-scripts.md),
[application resources](lifecycle.md) and [proof](command-project-testing.md).

longhorn build, typecheck and test delegate to the project's fixed scripts through
pnpm in that project's directory. Receiver, migration, operator, grant and backup
commands remain explicit application scripts with their separate authority and
configuration. The CLI creates no background PostgreSQL or receiver process.

For template=command-app and the exact unchanged start script
`node dist/operator-host.js`, with no prestart/poststart hooks, longhorn start runs
that Node host directly. It sends one shutdown request to the resource owner and
waits for actual exit, preserving its exit code. The host already owns HTTP drain,
cleanup/dispatcher shutdown and pool release. There is no inferred ownership for
arbitrary commands and no shell added around this direct host.

If the start script changes or pre/post hooks exist, the CLI retains normal pnpm
delegation and its process-tree signal policy. Installed tests verify the pnpm
script environment and a nonzero custom exit; hooks cannot be silently bypassed
by the direct-host optimization. Existing sqlite-auth launcher handling is retained.

The generated dev script keeps its existing behavior: build once, then Node watches
the built host. Source changes require rebuilding and restarting the affected
app/browser/receiver. This profile does not add source-aware reload, automatic
framework upgrades or multi-host orchestration.

The installed native gate sends SIGTERM to the CLI owner during real app restarts,
checks a clean result and rebinds the same listener. On POSIX it also sends an
actual SIGINT to the terminal process group; the host coalesces repeated shutdown
requests. Windows signal behavior, parent crash and deployment supervision require
their own execution evidence.
