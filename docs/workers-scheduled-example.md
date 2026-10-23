# Scheduled Worker audit example

Owner: [examples/scheduled-worker](../examples/scheduled-worker/src/index.ts).
Connects [scheduled events](workers-scheduled.md), DI, [memory scheduling](memory-scheduler.md),
[typed queues](queues.md), Web Crypto, KV bindings and [consumer tracing](scheduled-telemetry.md).

## Run locally

```sh
pnpm dev:scheduled-worker
curl 'http://127.0.0.1:3005/cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time=1790000000000'
curl http://127.0.0.1:3005/scheduled/last
curl http://127.0.0.1:3005/scheduled
curl http://127.0.0.1:3005/traces
```

`HOST`/`PORT` select the local address; `PORT=0` selects an available port. The
launcher prints the actual URL and manual trigger. `/cdn-cgi/mf/scheduled` is
the internal control route of the pinned Miniflare 3.20250718.3 host. It dispatches
a real workerd scheduled event; it is not an application HTTP route or a production
trigger API. The launcher installs no automatic cron timer. Ctrl+C awaits disposal.

| Application route | Behavior |
| --- | --- |
| `/health` | Application health response |
| `/scheduled` | Invocation stats and explicit storage kinds |
| `/scheduled/last` | Last completed audit, 404 before a write, 503 without AUDIT |
| `/traces` | Bounded local consumer spans and exporter stats |

## Connection chain

```text
platform scheduled event -> bounded adapter -> app.run -> DI tracer
  -> SHA-256([cron, scheduledTime]) -> invocation-owned MemorySchedulerStore
  -> one once-schedule -> tick(limit: 1) -> typed Queue.runOnce
  -> AUDIT.put(events/<stable job ID>) -> AUDIT.put(last-scheduled)
  -> scheduler.close + queue.close -> tracer.flush -> platform completion
```

Each invocation owns fresh paired memory schedule/queue state. The platform has
already chosen delivery time, so the one-shot uses `at: 0` to make it immediately
due. The stable ID is `audit.<sha256>`; the occurrence ID is
`scheduled:audit.<sha256>:0`. Payload validation uses a strict Zod schema. The job
gets one attempt and there is no polling worker. The handler closes its scheduler
and queue in `finally` and checks the event signal around KV writes.

The adapter admits two invocations per isolate with a ten-second cooperative
budget. A missing AUDIT binding explicitly calls `controller.noRetry()` and fails.
Other errors propagate without that application decision. One fixed-name consumer
span is flushed before completion; raw cron, job IDs and bindings are not recorded
as trace attributes.

## Storage and replay limits

Schedule definitions, cursors, queue claims, counters and traces are transient.
No pending work survives isolate loss. KV records are external effects: repeating
the same cron/time pair computes the same job ID and writes the same event value.
Execution still repeats; this is a same-value overwrite, not deduplication or
exactly-once delivery. The two KV puts have no shared transaction. `last-scheduled`
means the last completed pointer write, without ordering guarantees across events.

The local launcher supplies a temporary AUDIT KV namespace, discarded on exit.
The native gate explicitly persists its own temporary KV to test a fresh isolate.
Production namespace consistency and visibility belong to [Workers KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
This sample is not a durable queue/scheduler provider; durable shared state requires
a provider with the queue/cursor transaction and ownership guarantees documented
in [scheduler storage](scheduler.md).

`wrangler.example.toml` illustrates a Cron Trigger and a commented namespace
placeholder. Supply real deployment bindings separately. No namespace, account
connection or deployment is created by these commands. See [native proofs](workers-scheduled-testing.md).
