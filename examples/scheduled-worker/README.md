# Scheduled Worker

A runnable LongHorn Worker with a bounded scheduled handler, invocation-owned
memory scheduler/queue, KV audit effects and awaited consumer tracing.

From the workspace root:

```sh
pnpm dev:scheduled-worker
curl 'http://127.0.0.1:3005/cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time=1790000000000'
curl http://127.0.0.1:3005/scheduled/last
```

The trigger URL is the pinned local Miniflare control route. The launcher supplies
temporary KV and installs no automatic cron timer. Ctrl+C disposes the local host.
Repeating the same event overwrites its stable KV key; queue/cursor state is memory
scoped to that invocation. No cloud resources are deployed.

See [the example guide](../../docs/workers-scheduled-example.md) for the connection
chain, routes and storage limits; [adapter](../../docs/workers-scheduled.md),
[invocation ownership](../../docs/scheduled-invocations.md),
[telemetry](../../docs/scheduled-telemetry.md) and
[native verification](../../docs/workers-scheduled-testing.md) each have a guide.
`wrangler.example.toml` is a deployment configuration illustration with no real
namespace ID. Run `pnpm test:worker-scheduled` for the native workerd gate.
