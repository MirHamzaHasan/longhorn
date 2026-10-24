# Computed receipt storage

Owner: receiver/receiver.ts, receipts.ts and message-effect.ts. Every HTTP route
requires the private bearer capability before input validation. The receiver
validates the versioned numbers message, computes count/sum/min/max and awaits
the ReceiptStore's managed SQL transaction before acknowledgement.

Identical message IDs and effects dedupe. A different command/result under the
same ID conflicts. Protected reads return at most 100 effects for one command;
the app checks account ownership before contacting the receiver. The retained
local directory survives process restart. Connects [delivery](delivery.md),
[history](history.md), [setup](setup.md) and [backup](backup.md).

[Export computed receipts](receipt-export.md) from selected history or one command
through fresh protected reads. Recorded not-found observations stay distinct from
current delivery state; raw input numbers are excluded.
