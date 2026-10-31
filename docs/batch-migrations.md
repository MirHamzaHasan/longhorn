# SQLite batch schema history

Owner: `migrateSqliteBatch`, `verifySqliteBatchMigrations` and `BatchMigrationError`
from `@longhornjs/database/batch`. Connects the shared `Migration` manifest to an
atomic [BatchDatabase](batch-database.md). The [D1 deployment worker](d1-deployment.md)
uses it separately from application startup.

```ts
import { migrateSqliteBatch, verifySqliteBatchMigrations } from '@longhornjs/database/batch'

// Trusted deployment phase; database is an atomic SQLite BatchDatabase.
const appliedIds = await migrateSqliteBatch(database, migrations)
// Read-only application startup phase.
await verifySqliteBatchMigrations(database, migrations)
```

The runner snapshots the manifest before awaiting SHA-256. Each checksum covers
the exact JSON statement array, including whitespace and order. History must be
an exact ordered prefix of the supplied manifest; changed, reordered, missing or
extra applied migrations fail. Do not edit an applied migration.

Deployment first bootstraps two owned metadata tables in a batch, then reads the
bounded history. One later batch checks the exact observed prefix, applies the
complete missing suffix and writes each history row. A persisted CHECK-constrained
guard rejects a stale plan inside that batch. Competing deployments cannot both
apply the same upgrade. A SQL error rolls back all suffix DDL/data/history writes;
the bootstrap tables may already exist. No mutating operation is automatically
retried. After a competing upgrade, rerun explicitly to validate the new history.

Limits are 128 uniquely named migrations, 1000 statements per migration, 65536
UTF-8 bytes per statement and 1 MiB of manifest SQL. IDs use 1–128 ASCII letters,
digits or `._/-`. The complete apply batch, including its guard and history inserts,
defaults to at most 40 statements; `maxStatements` accepts 1–1000. Provider and
platform limits still apply. Oversized suffixes reject rather than silently split
an atomic upgrade. Deploy smaller reviewed releases when necessary.

`verifySqliteBatchMigrations` reads history only and requires the full manifest.
It never bootstraps tables or applies DDL. The task app additionally reads expected
columns at startup. History verifies the deployment record, not arbitrary live
schema tampering; migration SQL and database authority are trusted.

Errors expose only `operation`: input, bootstrap, history, capacity or apply.
They omit raw driver errors, SQL and arguments. This history uses
`longhorn_batch_migrations` and `longhorn_batch_migration_guard`, independently of
the callback-based [SQLite migration runner](migrations.md) and Wrangler history.
Do not alternate history owners for the same schema. [Native tests](d1-testing.md)
prove DDL rollback, checksum mismatch, one-winner upgrades and explicit reruns.
