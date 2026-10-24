import type { BatchDatabase,Migration,SqlValue } from '@longhorn/database'
import type { RateLimitReservation,ServerTimedRateLimit,ServerTimedRateLimitStore } from './types.js'
import { bounded,RateLimitError,reservation } from './protocol.js'
/** Separate schema from callback stores; this row is always complete after one native statement. */
export const batchRateLimitMigrations:readonly Migration[]=[{id:'longhorn_batch_rate_limit/001_buckets',statements:[
  `CREATE TABLE longhorn_batch_rate_limit_buckets(
    scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 128),
    subject_hash TEXT NOT NULL CHECK(length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
    policy_limit INTEGER NOT NULL CHECK(policy_limit BETWEEN 1 AND 1000000),
    window_ms INTEGER NOT NULL CHECK(window_ms BETWEEN 1000 AND 86400000),
    attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND policy_limit+1),
    expires_at INTEGER NOT NULL CHECK(expires_at BETWEEN 1 AND 9007199254740991),
    observed_at INTEGER NOT NULL CHECK(observed_at BETWEEN 0 AND 9007199254740991 AND expires_at>observed_at),
    PRIMARY KEY(scope,subject_hash)
  ) STRICT`,
  'CREATE INDEX longhorn_batch_rate_limit_expiry ON longhorn_batch_rate_limit_buckets(expires_at,scope,subject_hash)',
]}]
// SQLite guarantees identical 'now' values within one sqlite3_step. This avoids a
// client timestamp and does not require newer optional subsecond date modifiers.
const nativeNow="(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))"
const consumeSql=`INSERT INTO longhorn_batch_rate_limit_buckets(scope,subject_hash,policy_limit,window_ms,attempts,expires_at,observed_at)
  SELECT ?1,?2,?3,?4,1,clock.now+?4,clock.now FROM (SELECT ${nativeNow} AS now) AS clock WHERE 1
  ON CONFLICT(scope,subject_hash) DO UPDATE SET
    policy_limit=excluded.policy_limit,window_ms=excluded.window_ms,
    attempts=CASE WHEN expires_at<=excluded.observed_at THEN 1 ELSE min(attempts+1,excluded.policy_limit+1) END,
    expires_at=CASE WHEN expires_at<=excluded.observed_at THEN excluded.expires_at ELSE expires_at END,
    observed_at=excluded.observed_at
  WHERE expires_at<=excluded.observed_at OR (policy_limit=excluded.policy_limit AND window_ms=excluded.window_ms)
  RETURNING policy_limit,window_ms,attempts,expires_at,observed_at`
function integer(value:SqlValue|undefined):number{
  const number=typeof value==='bigint'?Number(value):value
  if(typeof number!=='number'||!Number.isSafeInteger(number))throw new RateLimitError('PROTOCOL')
  return number
}
/** One atomic SQLite statement over a borrowed batch provider, including native D1. */
export class BatchSqliteRateLimitStore implements ServerTimedRateLimitStore {
  readonly clock='server' as const
  constructor(private readonly database:BatchDatabase){
    if(database?.dialect!=='sqlite'||typeof database.execute!=='function'||typeof database.batch!=='function')throw new RateLimitError('INPUT')
  }
  async consume(input:RateLimitReservation):Promise<ServerTimedRateLimit>{
    const request=reservation(input),result=await this.database.execute({sql:consumeSql,args:[request.scope,request.key,request.limit,request.windowMs]})
    if(result.rowsAffected===0&&result.rows.length===0)throw new RateLimitError('POLICY_MISMATCH')
    if(result.rowsAffected!==1||result.rows.length!==1)throw new RateLimitError('PROTOCOL')
    const row=result.rows[0]!,limit=integer(row.policy_limit),window=integer(row.window_ms),attempts=integer(row.attempts),expiry=integer(row.expires_at),observed=integer(row.observed_at)
    if(limit!==request.limit||window!==request.windowMs||attempts<1||attempts>limit+1||observed<0||!Number.isSafeInteger(observed+window)||expiry<=observed)throw new RateLimitError('PROTOCOL')
    return Object.freeze({allowed:attempts<=limit,remaining:Math.max(0,limit-attempts),resetsAt:expiry,observedAt:observed})
  }
  async prune(input:{readonly limit:number}):Promise<number>{
    const limit=bounded(input.limit,10_000),result=await this.database.execute({sql:`DELETE FROM longhorn_batch_rate_limit_buckets WHERE (scope,subject_hash) IN (
      SELECT scope,subject_hash FROM longhorn_batch_rate_limit_buckets WHERE expires_at<=${nativeNow} ORDER BY expires_at,scope,subject_hash LIMIT ?1
    )`,args:[limit]})
    if(!Number.isSafeInteger(result.rowsAffected)||result.rowsAffected<0||result.rowsAffected>limit||result.rows.length!==0)throw new RateLimitError('PROTOCOL')
    return result.rowsAffected
  }
}
