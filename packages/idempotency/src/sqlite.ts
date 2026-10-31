import type { Database, Migration } from '@longhornjs/database'
import { SqlIdempotencyStore } from './sql.js'

/** Append to the application's complete ordered history. Object SQL uses this same schema. */
export const idempotencyMigrations: readonly Migration[] = [{ id: 'longhorn_idempotency/001_requests', statements: [
  `CREATE TABLE longhorn_idempotency_requests (
    scope TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
    claim TEXT NOT NULL, result TEXT, expires_at INTEGER,
    PRIMARY KEY(scope,request_key),
    CHECK((result IS NULL AND expires_at IS NULL) OR (result IS NOT NULL AND expires_at IS NOT NULL AND expires_at >= 0))
  ) STRICT`,
  'CREATE INDEX longhorn_idempotency_expiry ON longhorn_idempotency_requests(expires_at,scope,request_key) WHERE expires_at IS NOT NULL',
] }]
export class SqliteIdempotencyStore extends SqlIdempotencyStore {
  constructor(database: Database) { super(database, 'sqlite') }
}
