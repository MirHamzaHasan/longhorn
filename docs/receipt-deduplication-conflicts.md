# Stable receipt IDs and conflicting effects

Owner: ReceiptStore in `examples/outbox-worker/src/receipts.ts`. Connects
[broker deduplication](outbox-consumer-deduplication.md),
[HTTP acknowledgements](http-message-receiver.md) and Object SQL transactions.

The receipt table retains its original schema/migration: message_id is the primary
key, command_id identifies the business command and result stores validated JSON.
The broker and HTTP receiver use the same numbersReceipt calculation and storage
path. Both derive the result server-side from the validated versioned envelope.

Storage now inserts and checks duplicates within one managed transaction. A new
message ID inserts one effect. An existing ID with the same command ID and
canonical result returns the existing success. An existing ID with different
command/result returns 409 and preserves the original row. The comparison is of
the stored effect, not a fingerprint of every source-envelope byte. Distinct
inputs producing identical command/result are the same effect for this contract.

No migration is needed for existing stored receipts. Zod's validated result shape
and fixed serialization preserve comparison order with prior records. A broker
consumer treats a conflicting effect as failure under its existing retry/DLQ
policy. The HTTP publisher rejects the receiver's 409 and lets its Outbox budget
decide subsequent attempts. It never silently replaces another committed effect.

Object transaction/input gating coordinates concurrent attempts and preserves
rollback on failure. Actual remote acceptance remains at-least-once; this specific
idempotent SQL result survives repeated deliveries and receiver process restart.
It does not make unrelated external side effects transactional. Native tests
verify identical duplicates, conflicting results, unchanged original receipts,
real broker redelivery and interruption after remote commit. Reads materialize at
most 101 rows and reject commands with more than 100 receipts with 413, rather
than silently truncating an unbounded result.
