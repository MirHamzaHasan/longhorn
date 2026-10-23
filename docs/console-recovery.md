# Browser delivery recovery and audit

Owner: `examples/postgres/console/app.ts`. Connects the shared
[operations router](outbox-hono.md), [authorized retry](outbox-authorized-retry.md)
and [account attribution](account-operations.md).

An authenticated numbers-operator can inspect deliveries in the fixed numbers
queue, filter by state, load older records and open metadata detail. The browser
never fetches payloads or lease tokens. Members see an access-required state;
the server independently rejects operator API access.

For a failed delivery below its maximum allowed lifetime ceiling, the form shows
its current allowance, a bounded additional-attempt count and a reason. Submission
sends the displayed expectedMaxAttempts, additionalAttempts and reason. It sends
no actor, user, queue or owner claim. Current session/role policy is checked again
inside the transaction that changes delivery state and appends the audit record.

A stale ceiling returns conflict. The screen tells the operator to Refresh status
before retrying; it does not silently raise the new ceiling or automatically
resubmit a recovery request. Network failure also requires deliberate refresh
and review. Retry retains the original message ID and cumulative attempts.

Recovery audit lists actor IDs, reason, outcome and time, including conflicting
valid requests. Opening a delivery's recovery history scopes the same bounded
audit API to that ID. Succeeded transport delivery and computed receipt are
separate observations. The receipt consumer dedupes stable IDs under its existing
storage rules; there is no cross-service exactly-once guarantee.

The [browser gate](console-testing.md) causes an actual publisher outage, changes
the ceiling behind an open form, observes its 409 conflict, refreshes and recovers
the original delivery through the real consumer. Audit records preserve all three
actions and the member reads the computed result under the original ID.
