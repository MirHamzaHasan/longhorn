# Persistent HTTP message receiver

Owner: `examples/outbox-worker/src/receiver.ts` and
`scripts/serve-message-receiver.mjs`. Connects [bearer capabilities](bearer-capabilities.md),
[HTTP publishing](outbox-http-publisher.md), [receipt deduplication](receipt-deduplication-conflicts.md)
and the existing SQLite-backed ReceiptStore Object.

```sh
export RECEIVER_TOKEN="$(openssl rand -hex 32)"
pnpm dev:message-receiver
```

The local workerd host listens on 127.0.0.1:3012 by default. HOST/PORT can change
the listener. RECEIVER_DATA_PATH defaults to examples/outbox-worker/data/receiver;
keep that directory to retain receipt effects across restart. It is ignored by
version control. This host does not start a PostgreSQL service, queue broker or
temporary data sandbox. SIGINT/SIGTERM await startup and dispose the owned runtime;
normal exit does not remove persistent storage.

Every route requires the configured receiver capability before parsing input:

| Route | Behavior |
| --- | --- |
| GET /health | Activate/check receipt Object storage; {ready:true} on success |
| POST /messages | Validate command.numbers.v1, compute result, await SQL receipt, acknowledge matching message ID |
| GET /receipts/:commandId | UUID validation, protected bounded computed receipt response |

Bodies are limited to 16 KiB. Receipt reads return at most 100 effects; an
over-limit command returns 413 without a partial page. Missing/incorrect capabilities return 401;
invalid/missing receiver configuration returns 503. Responses use no-store and
Vary: Authorization. This is a server-to-server interface; the account host keeps
the capability private and applies command ownership before querying receipts.

The receiver acknowledges only after ReceiptStore's managed SQL operation
completes. Identical IDs dedupe; conflicting command/results return 409. A lost
HTTP response may cause another send and is handled by that durable ID boundary.
The original public/broker demonstration remains a separate executable; this
receiver exposes only its protected interface and exports ReceiptStore alone.

Production transport uses HTTPS through the deployment's ingress and its own
secret/storage lifecycle. Local native tests prove process restart and disk
persistence, not managed cloud failover or deployment. The launcher emits only
its listener URL and generic startup/shutdown diagnostics. See
[persistent verification](persistent-operations-testing.md).
