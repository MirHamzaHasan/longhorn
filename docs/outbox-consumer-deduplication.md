# Outbox application IDs and consumer effects

Owner: MessagePublisher contract and `examples/outbox-worker/src/receipts.ts`.
Connects [outgoing records](outbox.md), [binding adapter](workers-outbox-publisher.md),
[queue decisions](queue-message-decisions.md) and [pipeline](outbox-worker-example.md).

Outbox assigns its durable record ID when staging. Each attempt publishes that
same id/topic/data envelope. Broker re-publication can assign another transport
message ID even though the application operation is unchanged. Deduplication must
use envelope.id, not the broker's message.id. The latter still describes the
particular transport delivery for diagnostics and acknowledgement.

The example consumer validates the complete versioned envelope, calculates a
number summary and calls a private receipt Object route. Its SQL statement inserts
receipt/message ID/command ID/result with ON CONFLICT(message_id) DO NOTHING.
The receipt itself is the effect and its primary key is the deduplication record,
so they cannot diverge. The outer queue handler acknowledges only after the actual
storage response settles. SQL failure throws and the adapter leaves delivery for
retry. Invalid envelopes are deliberately acknowledged/dropped by this example;
applications needing quarantine/DLQ must select that policy explicitly.

The private store route is absent from the outer public router. Public GET
/receipts/:commandId reads receipts without exposing a write endpoint. This is a
shared-data demonstration, not tenant authentication. Production consumers must
derive their own authorization/scoping and trust only configured producers.

The same immutable message ID should mean the same topic/payload. Outbox preserves
that invariant across its attempts. The receipt store keeps the first accepted
effect on duplicates and now rejects a changed command/result with 409 in the
same transaction. This [effect comparison](receipt-deduplication-conflicts.md)
does not fingerprint every source-envelope byte. If that stronger distinction
is required, validate/store a fingerprint or enforce immutable producer ownership.

For an external effect such as a payment/email, a local receipt written separately
from the remote effect cannot by itself provide atomic deduplication. Pass a stable
idempotency key to that provider or use a protocol with equivalent guarantees.
Retain deduplication records across the possible delayed redelivery window.
[Native QA](outbox-testing.md) confirms two distinct broker delivery IDs for one
stable envelope ID, with exactly one persisted SQL receipt/effect.
The [HTTP receiver](http-message-receiver.md) shares this storage path and
acknowledges after effect commit; [persistent QA](persistent-operations-testing.md)
interrupts the publisher before that acknowledgement returns.
