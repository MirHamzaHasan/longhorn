# Account-scoped commands and operator recovery

Owner: `examples/postgres/src/operations.ts`. Connects [PostgreSQL accounts](postgres-accounts.md),
[idempotency](idempotency-postgres.md), [transaction authentication](transaction-authentication.md),
[Outbox](outbox-postgres.md), [shared HTTP](outbox-hono.md) and
[broker receipts](outbox-consumer-deduplication.md).

createPostgresApp accepts optional operations together with accounts. The normal
PostgreSQL executable stays unchanged. Opt-in hosts deploy the complete
[operations migration profile](operator-provisioning.md), supply a publisher
and optionally a readReceipt callback. Without a publisher the host is producer-only;
without a receipt reader that authorized route returns 503. Startup/readiness
check operation tables and the transaction-authentication EXECUTE grant.

| Route under /account | Policy and behavior |
| --- | --- |
| GET /commands | [History pages](account-command-history.md); own commands by default, explicit all scope for operators |
| POST /commands | Member; strict {id, numbers}; transactional user check, business row and outgoing message |
| GET /commands/:id | Command owner or numbers-operator; others receive 404 |
| GET /commands/:id/receipt | Same ownership check before the host's receipt reader |
| GET /operations/deliveries and /:id | numbers-operator; bounded metadata for one fixed queue |
| POST /operations/deliveries/:id/retry | numbers-operator; locked session/role recheck plus audit |
| GET /operations/audit | numbers-operator; bounded global/per-delivery history |

The existing account middleware supplies fresh public users, cookie/origin guards,
no-store and Vary: Cookie. Public registration remains member-only. Audit actor
is user:<verified-user-id>; bodies cannot choose actor, owner, role or queue.
All operators in this example manage command.numbers.v1 for this deployment.
This defines one shared operator scope, not an automatic multi-tenant policy.

Command idempotency uses a user-derived scope and client request key. Matching
requests replay for 24 hours; changed input conflicts; different users have
independent keys. New work rechecks the session inside the ledger/business/Outbox
transaction and compares its user to admission. A replay performs no new mutation
and uses request admission authorization. Read routes also use admission snapshots;
revocation does not retroactively cancel a read already admitted.

The command envelope matches the existing production Worker consumer. The host
owns publisher/receipt integration; effects dedupe stable message IDs. App startup
acquires the database and Outbox before its dispatcher; shutdown drains HTTP and
dispatcher before Outbox/database release. History deliberately outlives accounts
and business-row cleanup. See the [runnable demo](operator-accounts-demo.md) and
[native gate](operator-accounts-testing.md).
