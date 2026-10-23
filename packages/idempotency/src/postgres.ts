import type { Database, Migration } from '@longhorn/database'
import { SqlIdempotencyStore } from './sql.js'

/** Owned migration credentials apply this; runtime borrows SELECT/INSERT/UPDATE/DELETE only. */
export const postgresIdempotencyMigrations: readonly Migration[] = [{ id: 'longhorn_idempotency/001_requests', statements: [
  'CREATE SCHEMA longhorn_idempotency',
  'REVOKE ALL ON SCHEMA longhorn_idempotency FROM PUBLIC',
  `CREATE TABLE longhorn_idempotency.requests (
    scope text NOT NULL, request_key text NOT NULL, fingerprint text NOT NULL CHECK(length(fingerprint)=64),
    claim text NOT NULL, result text, expires_at bigint,
    PRIMARY KEY(scope,request_key),
    CHECK((result IS NULL AND expires_at IS NULL) OR (result IS NOT NULL AND expires_at IS NOT NULL AND expires_at >= 0))
  )`,
  'REVOKE ALL ON TABLE longhorn_idempotency.requests FROM PUBLIC',
  'CREATE INDEX requests_expiry ON longhorn_idempotency.requests(expires_at,scope,request_key) WHERE expires_at IS NOT NULL',
] }]
export class PostgresIdempotencyStore extends SqlIdempotencyStore {
  constructor(database: Database) { super(database, 'postgres') }
}
