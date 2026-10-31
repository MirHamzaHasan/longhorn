import type { Database, Migration } from '@longhornjs/database'
import { SqlSessionInventoryStore } from './sql-session-inventory.js'
/** Append after the complete application profile; legacy session writers need no new argument. */
export const sqliteSessionInventoryMigrations: readonly Migration[] = [{ id: 'longhorn_auth/002_session_inventory', statements: [
  "ALTER TABLE longhorn_auth_sessions ADD COLUMN session_id TEXT CHECK(session_id IS NULL OR (length(session_id)=32 AND session_id NOT GLOB '*[^a-f0-9]*'))",
  'UPDATE longhorn_auth_sessions SET session_id=lower(hex(randomblob(16)))',
  'CREATE UNIQUE INDEX longhorn_auth_session_reference ON longhorn_auth_sessions(session_id)',
  'CREATE INDEX longhorn_auth_session_inventory ON longhorn_auth_sessions(user_id,expires_at,session_id)',
  `CREATE TRIGGER longhorn_auth_session_reference_insert AFTER INSERT ON longhorn_auth_sessions WHEN NEW.session_id IS NULL
    BEGIN UPDATE longhorn_auth_sessions SET session_id=lower(hex(randomblob(16))) WHERE token_hash=NEW.token_hash; END`,
] }]
export class SqliteSessionInventoryStore extends SqlSessionInventoryStore {
  constructor(database: Database) { super(database, 'sqlite') }
}
