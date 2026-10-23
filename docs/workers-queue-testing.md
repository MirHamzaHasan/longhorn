# Queue-event native verification

Owner: [verify-worker-queues.mjs](../scripts/verify-worker-queues.mjs) and
[native fixture](../scripts/fixtures/worker-queues.mjs). Connects
[adapter](workers-queue-events.md), [decisions](queue-message-decisions.md),
[lifetime](queue-batch-lifecycle.md), [telemetry](queue-consumer-telemetry.md)
and [receipt example](queue-worker-example.md).

```sh
pnpm test:worker-queues
```

The command builds first. The gate browser-bundles built exports into actual local
Miniflare 3.20250718.3/workerd 1.20250718.0, compatibility date 2025-07-18. Its
test-only service binding uses service_binding_extra_handlers to call the native
Fetcher.queue event API inside workerd, producing real batches/messages/context
and native result flags. Calling a plain RPC method named queue is not this event
API. Those control routes/flag are not included in the example deployment config.

## Native event and broker proofs

- Original message queue/ID/timestamp/attempt/binding values reach the callback;
  Fetch and queue dispatch share startup.
- A mixed ack/retry/throw batch yields native exception outcome, one explicit ack,
  one explicit retry with delay, and no unconditional batch retry override. Delay
  boundaries 0/86400 survive as native flags without waiting that duration.
- A message pool leaves later callbacks unstarted while two I/O gates are held;
  overlapping batches occupy separate slots and an overflow event fails.
- A real exporter request retains completion/slot until released. Cooperative
  abort fails; ignored abort holds resources through concurrent core/adapter close,
  avoids late automatic ack, and later event admission fails.
- An actual producer/local broker re-delivers an explicitly retried message with
  the same ID and increased attempts. Exhaustion routes a poison message to a
  configured dead-letter consumer.

The pinned broker's packaged `workers/queues/broker.worker.js` tests batch failure
and retryMessages but does not consult explicitAcks when deciding redelivery.
Accordingly, partial-failure **native flags** and actual **broker retry/DLQ** behavior
are separate assertions. This is not proof that this emulator suppresses re-delivery
of every acknowledged message in a failed batch. The adapter preserves native
decisions; Cloudflare's documented platform precedence remains the deployment
contract. The gate neither upgrades nor patches third-party runtime tooling.

## Compiled application and launcher

The compiled example publishes valid HTTP input through the real broker, awaits
receipt processing, tests reuse of a business key with a changed payload, and checks
the effect route is not public. An external malformed producer message exercises
explicit invalid-input acknowledgement. Consumer spans omit payload/business IDs.
A fresh workerd host with the same Object namespace sees the prior SQL receipt and
fresh consumer counters. Broker-pending restart durability is not asserted.

The standalone launcher is tested over TCP with an owned temporary receipt path;
the gate waits for the receipt, signals shutdown, verifies disposal/exit and the
closed listener. Fixture I/O gates, temp bundles/storage and child processes are
released in finally. Normal example data and cloud accounts are untouched.

[Twelve source-level tests](../runtimes/workers/src/queue.test.ts) additionally cover
exact returned/waitUntil Promise identity, method receivers, message-array/options
snapshots, ordered original errors, metadata/decision validation, startup/registration
failure and startup budget. They run with the ordinary suite; native proof remains
this explicit gate. Existing runtime/project/storage/scheduled gates protect prior
adapters and generated framework snapshots.
