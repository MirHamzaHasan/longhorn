import type { Database,Migration } from '@longhorn/database'
import { SqlRateLimitStore } from './sql.js'
export const rateLimitMigrations:readonly Migration[]=[{id:'longhorn_rate_limit/001_buckets',statements:[
  `CREATE TABLE longhorn_rate_limit_buckets(
    scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 128),subject_hash TEXT NOT NULL CHECK(length(subject_hash)=64),claim TEXT NOT NULL CHECK(length(claim)>0),
    policy_limit INTEGER NOT NULL CHECK(policy_limit BETWEEN 1 AND 1000000),window_ms INTEGER NOT NULL CHECK(window_ms BETWEEN 1000 AND 86400000),
    attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND policy_limit+1),expires_at INTEGER,
    PRIMARY KEY(scope,subject_hash),
    CHECK((attempts=0 AND expires_at IS NULL) OR (attempts>=1 AND expires_at IS NOT NULL AND expires_at BETWEEN 0 AND 9007199254740991))
  ) STRICT`,
  'CREATE INDEX longhorn_rate_limit_expiry ON longhorn_rate_limit_buckets(expires_at,scope,subject_hash) WHERE expires_at IS NOT NULL',
]}]
export class SqliteRateLimitStore extends SqlRateLimitStore{constructor(database:Database){super(database,'sqlite')}}
