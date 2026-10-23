# Bounded recovery history

Owner: Outbox.auditHistory and OutboxAuditStore. Connects [audit records](outbox-audit.md),
[indexes](outbox-audit-storage.md), [HTTP cursors](outbox-audit-http.md) and
[independent retention](outbox-audit-retention.md).

```ts
const page = await outgoing.auditHistory({ deliveryId, limit: 20 })
const next = page.nextCursor
  ? await outgoing.auditHistory({ deliveryId, limit: 20, after: page.nextCursor })
  : undefined
```

Omit deliveryId for this Outbox's complete trail. Limit defaults to 50 and accepts
1–100. The page contains records and nextCursor or null. Every SQL query explicitly
selects audit columns and scopes queue; filtered reads also scope delivery_id. No
join to live job data is necessary, so deleted/missing deliveries retain history.

Records order ascending by createdAt and audit ID. The cursor contains queue,
deliveryId (or null for all deliveries), createdAt and id. It must be reused with
the same Outbox and filter. The service validates context, safe times and IDs
before querying. The HTTP example encodes this object as unsigned base64url
navigation data; authorization is separate.

createdAt is the service clock when the admitted action prepares its transaction,
not a database commit sequence. availableAt records the requested eligibility time,
including on a conflict/missing action; it is not the observed delivery's timing.
The result summary is historical. A scheduled/pending summary remains unchanged
when the worker later succeeds. Current state still comes from get/list.

This is live keyset pagination, not a global snapshot or total count. Concurrent
backdated/clock-skewed inserts behind a cursor or explicit pruning can change a
continuing walk. Hosts must choose coherent clocks and retention policies. Audit
reads join Outbox close draining, and database lifetime remains host-owned.
Source/native tests cover tied timestamps, context isolation, filtered/global
pages, real HTTP cursor walks and persistence after restart.
