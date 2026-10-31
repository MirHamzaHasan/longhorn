import type { Database,Migration } from '@longhornjs/database'
import { SqlRateLimitStore } from './sql.js'
export const postgresRateLimitMigrations:readonly Migration[]=[{id:'longhorn_rate_limit/001_buckets',statements:[
  'CREATE SCHEMA longhorn_rate_limit','REVOKE ALL ON SCHEMA longhorn_rate_limit FROM PUBLIC',
  `CREATE TABLE longhorn_rate_limit.buckets(
    scope text NOT NULL CHECK(char_length(scope) BETWEEN 1 AND 128),subject_hash text NOT NULL CHECK(char_length(subject_hash)=64),claim text NOT NULL CHECK(char_length(claim)>0),
    policy_limit integer NOT NULL CHECK(policy_limit BETWEEN 1 AND 1000000),window_ms integer NOT NULL CHECK(window_ms BETWEEN 1000 AND 86400000),
    attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND policy_limit+1),expires_at bigint,
    PRIMARY KEY(scope,subject_hash),
    CHECK((attempts=0 AND expires_at IS NULL) OR (attempts>=1 AND expires_at IS NOT NULL AND expires_at BETWEEN 0 AND 9007199254740991))
  )`,
  'REVOKE ALL ON TABLE longhorn_rate_limit.buckets FROM PUBLIC',
  'CREATE INDEX buckets_expiry ON longhorn_rate_limit.buckets(expires_at,scope,subject_hash) WHERE expires_at IS NOT NULL',
]}]
export class PostgresRateLimitStore extends SqlRateLimitStore{constructor(database:Database){super(database,'postgres')}}
