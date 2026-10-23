# Native outbox verification

Owner: `scripts/verify-outbox.mjs` and `scripts/fixtures/outbox-*`.
Connects [API](outbox.md), [dispatch lifecycle](outbox-dispatcher.md),
[SQLite](outbox-sqlite.md), [PostgreSQL](outbox-postgres.md),
[retention](outbox-retention.md) and [automatic broker example](outbox-worker-example.md).

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:outbox
```

Source tests use real SQLite to prove business/outgoing commit and rollback,
caught validation failure, stable envelopes, ambiguous acceptance retries,
terminal attempts, dispatcher/Outbox close drain, per-queue bounded retention and
unsafe scope/config rejection. Workers adapter tests verify the original JSON
envelope, actual promise settlement and cancellation without abandoning a send.
Type negatives preserve payload/publisher compatibility.

The native gate uses actual SQL drivers, workerd Queue bindings and consumer
events. SQLite and PostgreSQL producer processes pause before commit while an
independent observer checks that neither business nor outgoing state is visible.
SIGKILL rolls both back. Dispatcher processes then die before a broker send and
after an accepted real send but before local acknowledgement. Lease recovery
publishes again with the same ID. The broker emits distinct transport delivery IDs;
the recipient's SQL primary key preserves one effect. Terminal pruning is bounded;
the restricted PG delivery role retains DELETE denial and owner maintenance works.

The Object fixture wraps the compiled production example's binding only for
interruption injection. Actual state.abort after an alarm write proves command,
request, outgoing record and wakeup rollback. A producer-only host commits pending
work, then is fully disposed. A fresh enabled host activates its native alarm and
publishes. Reset after actual broker acceptance causes another attempt/send with
the same ID; a persisted boot marker proves the reset and the consumer retains
one receipt. HTTP replay/conflict/validation/private routing and receipt persistence
across another host restart are checked. The local launcher is also exercised over
TCP and must release its owned workerd on signal.

The gate owns all temporary SQL/Object storage, processes, pools, native PG cluster
and Miniflare instances and cleans them on success/failure. It never uses normal
example data or a cloud account. Existing queue/scheduler, alarm, request-idempotency
and project/runtime gates protect the reused foundations. Local broker proofs do
not establish managed-cloud deployment/failover, global ordering, exactly-once
delivery or cross-system commit. External consumers retain their own idempotency
and retention obligations.
