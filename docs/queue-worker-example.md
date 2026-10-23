# Platform queue receipt example

Owner: [examples/queue-worker](../examples/queue-worker/src/index.ts). Connects
Hono/core/DI, [queue events](workers-queue-events.md), [validation](validation.md),
[decisions](queue-message-decisions.md), [tracing](queue-consumer-telemetry.md)
and [Object SQL](workers-durable-sqlite.md) effect storage.

## Run

```sh
pnpm dev:queue-worker
curl -i http://127.0.0.1:3007/messages \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[2,4,6]}'
curl http://127.0.0.1:3007/receipts/first
curl http://127.0.0.1:3007/queue
curl http://127.0.0.1:3007/traces
```

Consumption starts automatically after publish; poll the receipt Location until
available (404 before processing). HOST/PORT select the local listener; PORT=0
prints an available port. The producer uses the actual local broker and workerd
queue handler; there is no HTTP route pretending to execute a message directly.

| Route | Behavior |
| --- | --- |
| POST `/messages` | Validate, await broker publish, 202 plus receipt Location |
| GET `/receipts/:id` | Persisted receipt or 404 |
| GET `/queue` | Isolate-local counters, invalid count and storage kinds |
| GET `/traces` | Bounded local consumer spans/stats |

Input is strict: ID matches `[A-Za-z0-9._:-]+`, 1–100 characters; numbers has
1–100 finite values in ±1e12. Bodies are bounded to 16 KiB and responses no-store.
This is a public single-workspace demo without account/tenant guards.

## Connections

```text
HTTP validation -> MESSAGES.send(JSON) -> platform/local broker
  -> queue event -> bounded adapter -> shared app.run -> DI consumer tracer
  -> payload validation -> count/sum/min/max
  -> RECEIPTS named Object -> own app/DI/startup SQL migrations
  -> INSERT receipt ON CONFLICT(id) DO NOTHING -> Object response/body
  -> explicit ack decision -> afterBatch tracer.flush -> platform completion
```

The receipt Object's `/store` effect route is not proxied by public HTTP. The first
result for a business ID wins, including if a later publish reuses it with different
numbers. Publishing again still creates a broker message and may run the handler
again; SQL idempotency preserves the first effect. This does not couple broker ack
and SQL commit into one transaction. The source message ID is stored internally,
while public receipt reads expose only business ID and result.

Malformed consumer payloads are explicitly acknowledged/dropped by this example;
an invalid counter makes the policy visible without retaining the raw body. HTTP
rejects such bodies before publishing, but other producers may send them. Storage
errors throw and follow broker retry policy. This example installs no quarantine
or dead-letter destination. See [decision policy](queue-message-decisions.md).

The adapter admits one batch with four message callbacks, a hundred-message
admission bound and a twenty-second cooperative budget. Local broker delivery uses
batches up to ten, immediate flush and three retries. These are distinct settings.
The example uses the platform broker directly, without creating an SQL QueueStore
or mirroring broker messages into LongHorn's own lease tables.

## Persistence and local tooling

Receipt SQL persists at `examples/queue-worker/data/objects`; RECEIPT_DATA_PATH
chooses another path. Receipts survive launcher restart; counters and spans reset.
The pinned local Miniflare broker holds pending deliveries in memory. Do not infer
broker persistence from the receipt namespace's durable path. Ctrl+C disposes the
local runtime; this is not a promise to drain every pending broker delivery.

Miniflare 3.20250718.3/workerd 1.20250718.0 retain Node 20.19+ tooling. That broker
does not apply workerd's explicit-ack list when retrying an otherwise failed batch;
extra local redelivery can occur. SQL idempotency handles duplicate effects. The
[native gate](workers-queue-testing.md) tests the actual native flags separately
from emulator redelivery. No Cloudflare account or deployment is used.
`wrangler.example.toml` illustrates application-owned queue producer/consumer and
Object class/binding configuration; provision real resources separately.
