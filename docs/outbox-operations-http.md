# Inspecting and retrying deliveries over HTTP

Owner: `examples/outbox-worker/src/operations.ts`, CommandStore and the outer
Worker router. Connects [authorization](outbox-operations-authorization.md),
[listing](outbox-inspection.md), [retry](outbox-deliberate-retry.md),
[migrations](outbox-recovery-migrations.md) and [native verification](outbox-recovery-testing.md).

Enable the deployment capability as described in the authorization guide, then:

```sh
curl -s 'http://127.0.0.1:3009/operations/deliveries?state=failed&limit=20' \
  -H "Authorization: Bearer $OUTBOX_OPERATIONS_TOKEN"
```

| Route | Result |
| --- | --- |
| GET /operations/deliveries | Bounded metadata page, failed state by default |
| GET /operations/deliveries/:id | Current delivery metadata or 404 |
| POST /operations/deliveries/:id/retry | Conditional failed-to-pending budget grant |

List query accepts state (pending/running/succeeded/failed), limit (1–100, default
50) and after (opaque base64url nextCursor from the preceding response). Keep the
same state when following a cursor. Queue/state context, cursor shape and size are
checked; the token is unsigned navigation data. Invalid/unknown query values return
400. Pages contain deliveries and nextCursor or null, with no payload/lease token.

Copy the target UUID and observed maxAttempts from inspection:

```sh
curl -i http://127.0.0.1:3009/operations/deliveries/DELIVERY_UUID/retry \
  -H "Authorization: Bearer $OUTBOX_OPERATIONS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"expectedMaxAttempts":3,"additionalAttempts":2,"delayMs":0}'
```

The strict body requires expectedMaxAttempts (1–100), accepts additionalAttempts
(1–100, default 3) and delayMs (0–86,400,000, default 0). Unknown fields, non-UUID
IDs and invalid bodies return 400 before mutation. Retrying another Outbox's ID is
missing within this queue scope. The successful response is 202 with the resulting
delivery metadata and Location pointing to its existing /deliveries/:id resource.

A stale ceiling, ineligible state or exhausted resulting ceiling returns 409 with
an explanation and current metadata; a pruned/unknown ID returns 404. The new
ceiling cannot exceed 100. No response claims that a consumer has executed. The
automatic alarm may already have advanced beyond the returned pending snapshot.
Losing a successful reply and resending its old expected ceiling yields 409; inspect
the current row rather than automatically granting another budget.

The existing command/outbox/provider DI and alarm host handle the operation. Retry
and wakeup commit together on Object SQL; a native interruption rolls both back.
The same message ID reaches the broker again, allowing the existing receipt effect
to dedupe an earlier ambiguous acceptance. These routes do not expose payload edit,
manual success, arbitrary state mutation or broker-side deletion. The public command
API remains separate. The route now appends a transactional [recovery audit](outbox-audit-http.md),
using a server-bound service actor and optional reason code. Replies also include
audit metadata; [GET /operations/audit](outbox-audit-history.md) supplies history.
