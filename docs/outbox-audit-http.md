# Audited operations requests and history HTTP

Owner: `examples/outbox-worker/src/operations.ts`, CommandStore bindings and the
outer Worker router. Connects [operations authorization](outbox-operations-authorization.md),
[actor policy](outbox-audit-attribution.md), [retry](outbox-audit.md),
[history](outbox-audit-history.md) and [migration](outbox-audit-storage.md).

The existing authorized POST /operations/deliveries/:id/retry now uses the audited
transaction. Its existing ceiling/additional-attempt/delay fields remain supported.
Optional reason chooses manual-retry, provider-restored, configuration-fixed or
investigating; omitted reason defaults to manual-retry. The server supplies actor
from OUTBOX_OPERATIONS_ACTOR, default service:outbox-operations. Incoming actor or
other unknown fields return 400 and produce no event.

```sh
curl -i http://127.0.0.1:3009/operations/deliveries/DELIVERY_UUID/retry \
  -H "Authorization: Bearer $OUTBOX_OPERATIONS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"expectedMaxAttempts":3,"additionalAttempts":2,"reason":"provider-restored"}'
```

Successful 202 replies include delivery and audit. Valid 409 conflict/budget replies
include their audit and current delivery; a valid missing target returns 404 with
an audit whose result is null. Audit/schema/permission failure returns a generic
server failure and rolls back the transition. Neither 400 validation failures nor
401 authorization failures append history.

GET /operations/audit returns records and nextCursor or null:

```sh
curl -s 'http://127.0.0.1:3009/operations/audit?limit=20' \
  -H "Authorization: Bearer $OUTBOX_OPERATIONS_TOKEN"
```

Query accepts optional deliveryId UUID, limit 1–100 (default 50) and the opaque
base64url after cursor from a prior response. Keep the same delivery filter while
following pages. Queue/filter/cursor shape/size are checked; unknown query fields
return 400. History still works after the live delivery was pruned. No token,
payload or lease token is added to responses or audit fields by the demo.

Both routes inherit the existing bearer guard, no-store responses and Vary:
Authorization. With no operations token configured the routes are absent. The
launcher passes optional OUTBOX_OPERATIONS_ACTOR as a binding; use a stable service
label and rotate/restart through the host's existing secret configuration. This
shared credential does not establish a human identity. Existing actor labels stay
unchanged across credential/label rotation. No HTTP audit-delete route is exposed.
See [native HTTP/rollback/rotation checks](outbox-audit-testing.md).
