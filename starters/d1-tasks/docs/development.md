# Development and compiled start

pnpm dev uses esbuild's source graph watcher. Successful builds stop the owned
Node/workerd host before launching its replacement, retaining the same storage
directory. Compilation errors keep the previous host running; saving a fix reloads.
Schema/configuration startup errors stop development with failure so they can be
corrected and deliberately restarted. Repeated signals share cleanup.

PORT=0 may choose a new URL after reload; read the latest listening record. Reload
can interrupt requests, so retain creation keys for retry. Restart development
after changing environment, build.config.mjs or host tooling. pnpm build followed
by pnpm start runs the same compiled host without watching. See
[configuration](configuration.md), [lifecycle](lifecycle.md) and [testing](testing.md).
