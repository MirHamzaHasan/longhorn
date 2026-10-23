# Outage and recovery walkthrough

Create member and operator accounts in the console; grant the operator using the
trusted CLI described in setup.md and sign in again. Create `4, 8, 15` as the
member and Refresh status to see its computed receipt (count 3, sum 27).

Stop the receiver with Ctrl+C. Submit `18, 22` as the member and refresh until
delivery is Failed. The app's readiness becomes unavailable while protected
receipt health cannot be reached. Restart the receiver with the same credential
and data directory. As the operator, open Deliveries, inspect the failed record,
choose Provider restored and retry with one additional attempt. Refresh status
and read Recovery audit. The member's original command now has a receipt with
sum 40 under the original delivery ID.

A stale retry form returns conflict and requires Refresh status before a new
deliberate action. Retries keep cumulative attempts and message IDs. An unchanged
command form retains its request key after network loss, but navigation/reload
loses that in-memory key; inspect history after an ambiguous reloaded submission.

Restart both hosts with retained PostgreSQL and receiver storage. Sign in again
and verify history, receipt and audit. Independent delivery/receipt retention can
make old metadata unavailable. Delivery acknowledgement is separate from database
commit; consumer dedupe handles repeated stable IDs without a cross-service
exactly-once guarantee.
