import type { Migration } from '@longhorn/database'
import { postgresOutboxMigrations, postgresOutboxRecoveryMigrations, postgresOutboxAuditMigrations } from '@longhorn/outbox/postgres'
import { postgresExampleMigrations } from './migrations.js'
import { postgresAuthTransactionMigrations } from '@longhorn/auth/postgres'
import { postgresCommandHistoryMigrations } from './command-history-migrations.js'
/** Explicit operations deployment profile; preserve the normal example's complete deployed history first. */
export const postgresOperationsBaseMigrations: readonly Migration[] = [
  ...postgresExampleMigrations, ...postgresAuthTransactionMigrations, ...postgresOutboxMigrations, ...postgresOutboxRecoveryMigrations, ...postgresOutboxAuditMigrations,
  { id: 'postgres_account_operations/001_commands', statements: [
    `CREATE TABLE longhorn_pg_example.operator_commands (
      id text PRIMARY KEY, owner_id text NOT NULL CHECK(length(owner_id)>0),
      numbers jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(numbers)='array' AND pg_catalog.jsonb_array_length(numbers) BETWEEN 1 AND 100)
    )`,
    'CREATE INDEX operator_commands_owner ON longhorn_pg_example.operator_commands(owner_id,id)',
  ] },
]
export const postgresOperationsMigrations: readonly Migration[]=[...postgresOperationsBaseMigrations,...postgresCommandHistoryMigrations]
