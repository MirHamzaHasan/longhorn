# SQL outbox to broker to receipts

Run `pnpm dev:outbox-worker` from the repository root, then POST /commands with
`{"id":"request-123","numbers":[2,4,6]}`. The 201 response links the committed
command, outgoing delivery and eventual receipt. Repeating the same input/key
replays the original result; changed input returns 409.

The command Object commits business/request/outgoing state and its alarm together.
The alarm publishes to a native queue binding; the queue consumer dedupes the
stable envelope ID in a separate receipt Object. Local storage defaults to data/objects;
HOST, PORT, OUTBOX_DATA_PATH and DISPATCH_ENABLED configure the launcher.

See [the full example](../../docs/outbox-worker-example.md), [API](../../docs/outbox.md),
[publisher](../../docs/workers-outbox-publisher.md), [consumer effects](../../docs/outbox-consumer-deduplication.md)
and [native verification](../../docs/outbox-testing.md) for connections and limits.

Optional [operations](../../docs/outbox-operations-http.md) add bounded status pages
and failed-delivery retries that preserve message identity and cumulative attempts.
Configure a random OUTBOX_OPERATIONS_TOKEN to enable the bearer-protected routes;
they are absent by default. See [authorization](../../docs/outbox-operations-authorization.md),
[migration upgrade](../../docs/outbox-recovery-migrations.md) and
[native recovery checks](../../docs/outbox-recovery-testing.md).

Those retries now append [audit records](../../docs/outbox-audit.md) in the same
transaction. OUTBOX_OPERATIONS_ACTOR sets a server-owned service label; the body may
select a reason code. GET /operations/audit returns scoped history, including after
delivery cleanup. See [HTTP policy](../../docs/outbox-audit-http.md),
[schema/grants](../../docs/outbox-audit-storage.md) and [native proof](../../docs/outbox-audit-testing.md).
