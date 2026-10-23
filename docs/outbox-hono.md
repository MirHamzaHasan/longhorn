# Shared Hono operations adapter

Owner: `createOutboxOperations` from `@longhorn/outbox/hono`. Connects
[inspection HTTP](outbox-operations-http.md), [audit HTTP](outbox-audit-http.md),
[service authorization](outbox-operations-authorization.md) and
[account operations](account-operations.md).

The optional entrypoint depends on Hono, Zod and LongHorn validation; the root
Outbox entrypoint imports no HTTP implementation. It returns a Hono router with
GET /deliveries, GET /deliveries/:id, POST /deliveries/:id/retry and GET /audit.
Mount it under an application prefix. Options are:

| Option | Responsibility |
| --- | --- |
| resolve(context) | Resolve one policy-scoped Outbox, usually from DI |
| authorize(context, action) | Required admission gate returning an actor or denial Response |
| authorizeRetry(context, tx) | Optional transactional recheck returning the same actor |
| location(id) | Customize successful retry Location for the mount prefix |

Authorization runs before body, UUID and query validation. The adapter sets
Cache-Control: no-store and validates the server actor format. The application
owns cookie/origin or bearer validation, Vary headers, principal/tenant policy
and response status choices. Generic Hono bindings/variables reach callbacks;
the original admitted context is retained privately across validator middleware.

Retry JSON rejects client actor claims and accepts the observed attempt ceiling,
bounded additional attempts/delay and the existing reason codes. Authorized retry
uses the transactional callback when supplied and rejects an actor different from
the admitted identity. Without that callback it uses the admission actor with
retryFailedAudited. Missing/conflict/scheduled preserve 404/409/202 behavior.

Pages are bounded to 100 and cursors bind queue, state or audit delivery filter.
They are opaque encodings, not authentication credentials. Inspection exposes
metadata without payload/lease tokens. The Worker service example and PostgreSQL
account example share this implementation. Existing recovery/audit native gates
cover the service path; [account verification](operator-accounts-testing.md)
covers cookie policy, transactional identity and human attribution.
