import type { Database } from '@longhorn/database'
import { IdempotencyConflictError, idempotencyTime } from './index.js'
import type { IdempotencyStore, StoredRequest, StoredResult } from './index.js'

/** Internal shared algorithm; syntax and migrations stay in explicit dialect entrypoints. */
export class SqlIdempotencyStore implements IdempotencyStore {
  constructor(private readonly database: Database, private readonly dialect: 'sqlite' | 'postgres') {
    if (database.dialect !== dialect) throw new Error(`${dialect} idempotency requires a ${dialect} database`)
  }
  async run(request: StoredRequest, work: Parameters<IdempotencyStore['run']>[1]): Promise<StoredResult> {
    const pg = this.dialect === 'postgres', table = pg ? 'longhorn_idempotency.requests' : 'longhorn_idempotency_requests'
    return this.database.transaction(async tx => {
      const claim = crypto.randomUUID()
      // The no-op conflict update acquires native row/write ownership, including during expiry reuse.
      const row = (await tx.execute({ sql: `INSERT INTO ${table} (scope,request_key,fingerprint,claim,result,expires_at)
        VALUES (${pg ? '$1,$2,$3,$4' : '?,?,?,?'},NULL,NULL)
        ON CONFLICT (scope,request_key) DO UPDATE SET request_key = excluded.request_key
        RETURNING fingerprint,claim,result,expires_at`, args: [request.scope, request.key, request.fingerprint, claim] })).rows[0]
      if (!row) throw new Error('Idempotency ownership returned no row')
      const now = idempotencyTime(request.now)
      if (row.claim !== claim) {
        const expiry = typeof row.expires_at === 'bigint' ? Number(row.expires_at) : row.expires_at
        if (typeof row.result !== 'string' || typeof expiry !== 'number' || !Number.isSafeInteger(expiry)) throw new Error('Invalid committed idempotency record')
        if (expiry > now) {
          if (row.fingerprint !== request.fingerprint) throw new IdempotencyConflictError()
          return { result: row.result, replayed: true, expiresAt: expiry }
        }
      }
      const result = await work(tx), expiresAt = idempotencyTime(request.now) + request.retentionMs
      if (!Number.isSafeInteger(expiresAt)) throw new Error('Idempotency expiry exceeds safe integer range')
      const updated = await tx.execute({ sql: `UPDATE ${table} SET fingerprint=${pg ? '$1' : '?'},claim=${pg ? '$2' : '?'},result=${pg ? '$3' : '?'},expires_at=${pg ? '$4' : '?'}
        WHERE scope=${pg ? '$5' : '?'} AND request_key=${pg ? '$6' : '?'}`, args: [request.fingerprint, claim, result, expiresAt, request.scope, request.key] })
      if (updated.rowsAffected !== 1) throw new Error('Idempotency ownership lost')
      return { result, replayed: false, expiresAt }
    })
  }
  async prune(input: { readonly now: number; readonly limit: number }): Promise<number> {
    // Native statements are atomic; PG skips records held by active producers/replayers.
    const sql = this.dialect === 'postgres' ? `WITH expired AS (
      SELECT scope,request_key FROM longhorn_idempotency.requests WHERE expires_at <= $1
      ORDER BY expires_at,scope,request_key LIMIT $2 FOR UPDATE SKIP LOCKED
    ) DELETE FROM longhorn_idempotency.requests AS requests USING expired
      WHERE requests.scope=expired.scope AND requests.request_key=expired.request_key` :
      `DELETE FROM longhorn_idempotency_requests WHERE (scope,request_key) IN (
        SELECT scope,request_key FROM longhorn_idempotency_requests WHERE expires_at <= ? ORDER BY expires_at,scope,request_key LIMIT ?)`
    return (await this.database.execute({ sql, args: [input.now, input.limit] })).rowsAffected
  }
}
