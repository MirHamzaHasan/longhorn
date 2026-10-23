# Native account history verification

Owner: scripts/verify-command-history.mjs, its migration process fixture and
command-history.test.ts. Connects [API](account-command-history.md),
[upgrade](command-history-migrations.md), [cursors](command-history-cursors.md)
and [safe status](command-history-delivery.md).

```sh
pnpm test:command-history
```

The gate owns a native PostgreSQL sandbox, first deploying the actual old
operations profile. It seeds retained, pruned, ambiguous and mismatched outgoing
records, plus invalid JSON/Unicode/numeric payloads. A separate owner process
performs the new migration and waits before commit. SIGKILL leaves the schema
and migration history unchanged; two subsequent owner processes serialize and
append the upgrade once. Legacy checksums and command rows survive.

The compiled app runs over TCP with restricted runtime credentials, real scrypt,
existing cookie sessions and trusted operator provisioning. Checks cover own
versus global pages, anonymous/member denial before validation, duplicate scope
claims, unknown owner/queue parameters, malformed and context-forged cursors,
and revoked sessions/roles. Concurrent writers have unique histories. Saved
cursors traverse older pages after actual app restart; a fresh page sees a newer
insert. A delayed lower-position commit is observed on the next page. int64
positions above JavaScript's safe range retain exact seek comparisons.

The gate separately grants a projection-only role access to required metadata
columns. It can run the repository while numbers/payload/lease-token reads fail
with 42501. Deleting a retained outgoing row leaves its history ID association
with unavailable metadata. A real Outbox dispatch changes live status. A failed
business insertion rolls back its previously staged outgoing record. Existing
idempotent creates still replay once rather than duplicating history.

Source tests validate cursor context/ranges, request bounds and the explicit
projection. Captured process output excludes credentials. Existing operator,
persistent-host and PostgreSQL gates remain regression coverage. Live keyset
pages are not a database snapshot or a guarantee against late-commit refresh.
