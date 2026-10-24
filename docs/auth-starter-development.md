# Owned auth source development

Owner: generated `dev.mjs` and `build.config.mjs`. Node/esbuild watches editable
source for all three native profiles, using the same [host acquisition](auth-starter-launcher.md)
as compiled start. Runtime APIs stay in the selected native host; the watcher
does not insert native imports into the shared application or core.

For the unchanged generated dev/start scripts without pre/post hooks, the CLI
launches the Node owner directly and forwards one signal to it. The owner then
drains its native child. Other/custom scripts keep generic pnpm delegation.
On POSIX the native child has its own process group, so terminal group signals
do not race the parent's close with a second native signal.
The exact selection and fallback contract is recorded in [CLI script ownership](cli-owned-scripts.md).

Compilation failure leaves the previous app serving. A successful build enters
a serialized sequence: close the old host, wait for actual exit/storage release,
reload configuration, then acquire the replacement. The app drains accepted
HTTP/native password work before SQL close. If configuration, migration checks or
native startup fail, development ends with a nonzero status. There is no automatic
crash restart or descendant supervision.

The watcher owns its build service and direct native child. Parent signals abort
new acquisitions, dispose the watcher, join queued reload work, close the current
host and report completion. Repeated shutdown uses one promise. Configuration
files are read per launch, but changing an environment file alone does not trigger
source recompilation; edit source or restart development to apply it.

The [packed gate](auth-starter-testing.md) injects a compile error and proves the
previous listener/session still works, then changes a health response and verifies
one replacement after the old stop. Retained sessions and notes survive. It also
checks invalid configuration creates no data directory and changed original note
migration SQL refuses readiness until source is restored.
