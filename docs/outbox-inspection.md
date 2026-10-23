# Bounded outgoing delivery inspection

Owner: Outbox.list and the optional OutboxRecoveryStore capability. Connects
[Outbox](outbox.md), [recovery index](outbox-recovery-migrations.md),
[deliberate retry](outbox-deliberate-retry.md) and [operations HTTP](outbox-operations-http.md).

```ts
const page = await outgoing.list({ state: 'failed', limit: 20 })
const next = page.nextCursor
  ? await outgoing.list({ state: 'failed', limit: 20, after: page.nextCursor })
  : undefined
```

The default state is failed and default limit is 50. A request selects exactly one
of pending/running/succeeded/failed with a limit of 1–100. Results contain JobInfo
metadata only, never stored payloads or lease tokens. Built-in stores explicitly
project metadata columns in SQL rather than retrieving private columns and relying
on later stripping. lastFailure is the existing category (handler, invalid-payload,
lease-expired or null); it is not arbitrary exception text. leaseUntil is public
timing metadata, distinct from the secret lease ownership token.

Pages order ascending by original createdAt and ID, including deterministic ties.
The nextCursor object contains queue, state, createdAt and id; it points after the
last returned row only when another row was observed. Pass it to the same Outbox
and state filter. The service rejects cross-queue/filter cursors and unsafe times/
IDs before querying. The HTTP example encodes this object as an opaque base64url
query token; that encoding is not a signature or authorization mechanism.

This is a live keyset listing, not a snapshot or total count. Records may change
state or be pruned between requests; newly matching records behind the cursor can
be absent from a continuing page walk. Refresh from the beginning to inspect the
current failed set. Ordering uses creation time, not the time of the last failure.
The recovery index supports queue/state/creation/ID selection without OFFSET.

list joins Outbox maintenance admission and close draining. It borrows database
lifetime. Older custom stores implementing only enqueue/dispatch/prune remain
compatible; list rejects if the optional capability is absent. Raw store contracts
trust normalized arguments; applications use Outbox.list. Native/source tests cover
all states, tied timestamps, context checks, actual HTTP cursors and metadata
projection. See [verification](outbox-recovery-testing.md).
