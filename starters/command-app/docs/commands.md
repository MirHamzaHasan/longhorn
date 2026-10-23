# Command submission and replay

Owner: src/operations.ts and operation-contracts.ts. Members submit a bounded
validated numbers array. Owner identity comes from the authenticated principal.
The request key scopes replay to that user and canonical input. One managed
PostgreSQL transaction commits the command, history/delivery association, outgoing
record and replay result. A rollback commits none of those writes.

The browser retains its key for unchanged failed submissions while the form stays
open. After navigation/reload, inspect history if submission was ambiguous. Replay
is bounded by the existing ledger retention policy, not a permanent promise.
Connects [history](history.md), [transactions](transactions.md) and [delivery](delivery.md).
