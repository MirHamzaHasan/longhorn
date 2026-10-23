# Recovery state, audit and alarm atomicity

Owner: SqlOutboxAudit and the existing native Database transaction contract.
Connects [audit API](outbox-audit.md), [conditional retry](outbox-recovery-concurrency.md),
[alarm projection](alarm-wakeup-planning.md) and [native tests](outbox-audit-testing.md).

The audited store opens one native transaction. SqlOutboxRecovery applies its
existing conditional UPDATE through that transaction executor, including its
metadata read when no row changes. The store then inserts the action/result row
through the same executor. The outer transaction commits only after both finish.
Audit conversion/constraint/permission/storage failure rolls everything back.

Only scheduled means this action changed the delivery. Conflict, budget-exhausted
and missing are valid diagnostic results and also receive a committed audit record.
That summary is what the action observed; it may become historical immediately.
Malformed library/HTTP input and unauthorized requests never reach an audit append.
Operational/database failure does not create an exception-text audit record; request
diagnostics remain a separate concern.

Competing identical-ceiling actions grant one budget and commit one event per valid
caller, with different event IDs. The old ceiling cannot match the new generation.
A process killed before commit leaves old state and no event; after commit the
pending row and event survive. A client retry after a lost reply is a new action
and can append a conflict rather than repeating the grant. There is no hidden
client action-id deduplication protocol.

Object SQL runs its existing before-commit alarm hook after the transaction's
state/audit work. An actual state.abort after native setAlarm rolls back the event,
budget/state and wakeup together. A later admitted retry can commit and wake an
automatic publisher under the original message ID. Consumer effects still dedupe
that ID; the audit transaction does not enclose remote broker acceptance.

There are no out-of-transaction audit callbacks or fire-and-forget inserts.
Database/Outbox/HTTP or app.run ownership must surround the full result. The table
is append-only through the normal runtime API/role, but trusted owners and explicit
retention can alter/remove history. It does not audit unaudited APIs/direct SQL or
provide a cryptographic tamper-proof log.
