# Platform queue receipts

From the workspace root:

```sh
pnpm dev:queue-worker
curl -i http://127.0.0.1:3007/messages \
  -H 'Content-Type: application/json' -d '{"id":"first","numbers":[2,4,6]}'
curl http://127.0.0.1:3007/receipts/first
```

Poll the receipt until the automatic broker consumer writes its result. Receipt
SQL persists at data/objects (or RECEIPT_DATA_PATH); local broker-pending state,
consumer counters and traces are transient. Reusing a business ID preserves its
first result. Ctrl+C disposes local workerd; no cloud deployment is created.

See [the full example](../../docs/queue-worker-example.md),
[adapter](../../docs/workers-queue-events.md),
[ack/retry policy](../../docs/queue-message-decisions.md),
[batch ownership](../../docs/queue-batch-lifecycle.md),
[telemetry](../../docs/queue-consumer-telemetry.md) and
[native proof/emulator limits](../../docs/workers-queue-testing.md).
Run `pnpm test:worker-queues` for the real workerd/broker gate.
