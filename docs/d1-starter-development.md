# Owned D1 development reloads

Owner: starters/d1-tasks/dev.mjs, build.config.mjs and the adapted local host.
Connects [generated source](d1-starter.md), [schema ownership](d1-deployment.md),
[configuration](configuration.md) and [native proof](d1-starter-testing.md).

pnpm dev uses esbuild's browser graph watcher. The first successful build starts
the Node/Miniflare host. Later successful builds serialize stopping that owned
host before starting another against the same retained directory. The host
privately applies checked schema, removes the schema worker and verifies readiness
before logging HTTP server listening. Each worker keeps its compatibility date.

Compilation errors log D1 development build failed and keep the previous host.
A corrected save rebuilds/replaces it. Configuration or schema startup failure
stops development with a nonzero result and disposes the watcher. Restore valid
source/configuration and rerun; no failed readiness is presented as a running app.
Changing applied migration text is deliberately rejected, preserving retained data.

Signals share one shutdown, dispose the watcher, await reload work and stop the
owned host. A bounded forced-stop fallback reports failure. CLI delegation retains
its existing process-subtree forwarding. Reload may interrupt HTTP after commit;
creation keys recover original responses within retention. Platform isolate
eviction still has no arbitrary final-cleanup guarantee.

The default address is 127.0.0.1:3000. PORT=0 may select a different URL after reload;
read the latest record. HOST/PORT/D1_DATA_PATH and D1 request settings use process
environment, without dotenv loading. Restart after changing environment, host
tooling or build.config.mjs. pnpm build plus pnpm start uses the same compiled
application/host without a watcher. This development lifetime is not a cloud
deployment or zero-downtime rollout protocol.
