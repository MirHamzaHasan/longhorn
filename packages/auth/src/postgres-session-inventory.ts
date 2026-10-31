import type { Database, Migration } from '@longhornjs/database'
import { SqlSessionInventoryStore } from './sql-session-inventory.js'
/** Append after the complete application history; existing functions/inserts use the native default. */
export const postgresSessionInventoryMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_auth/004_session_inventory', statements: [
  "ALTER TABLE longhorn_auth.sessions ADD COLUMN session_id text COLLATE \"C\" NOT NULL DEFAULT replace(pg_catalog.gen_random_uuid()::text,'-','') CHECK(session_id ~ '^[a-f0-9]{32}$')",
  'CREATE UNIQUE INDEX session_reference ON longhorn_auth.sessions(session_id)',
  'CREATE INDEX session_inventory ON longhorn_auth.sessions(user_id,expires_at,session_id)',
] }]
export class PostgresSessionInventoryStore extends SqlSessionInventoryStore {
  constructor(database: Database) { super(database, 'postgres') }
}
export async function checkPostgresSessionInventory(database: Database): Promise<void> {
  await database.execute('SELECT session_id,user_id,token_hash,expires_at FROM longhorn_auth.sessions LIMIT 0')
  const row = (await database.execute("SELECT (pg_catalog.has_function_privilege(current_user,'longhorn_auth.lock_session_user(text)','EXECUTE') AND pg_catalog.has_function_privilege(current_user,'pg_catalog.gen_random_uuid()','EXECUTE')) AS allowed")).rows[0]
  if (row?.allowed !== true) throw new Error('Session inventory requires the existing transaction-auth grant')
}
