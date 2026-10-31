import type { Database } from '@longhornjs/database'
import type { SessionControlInput, SessionControlStore } from './types.js'
import { sessionControlTime, snapshotSessionControl } from './session-control.js'

export async function checkPostgresSessionControls(database: Database): Promise<void> {
  const row = (await database.execute({ sql: "SELECT pg_catalog.has_function_privilege(current_user,$1,'EXECUTE') AS allowed", args: ['longhorn_auth.lock_session_user(text)'] })).rows[0]
  if (row?.allowed !== true) throw new Error('Transactional session authentication must be deployed and granted')
}

/** Uses the existing opt-in transaction-auth function and built-in advisory ownership. */
export class PostgresSessionControlStore implements SessionControlStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL session controls require a PostgreSQL database')
  }
  async revoke(value: SessionControlInput, now: () => number): Promise<number | undefined> {
    const { tokenHash, scope } = snapshotSessionControl(value)
    if (typeof now !== 'function') throw new Error('A session control clock is required')
    return this.database.transaction(async tx => {
      const isolation = (await tx.execute("SELECT pg_catalog.current_setting('transaction_isolation') AS isolation")).rows[0]
      if (isolation?.isolation !== 'read committed') throw new Error('Session controls require READ COMMITTED isolation')
      const hint = (await tx.execute({ sql: 'SELECT user_id FROM longhorn_auth.sessions WHERE token_hash=$1', args: [tokenHash] })).rows[0]
      if (!hint) return undefined
      if (typeof hint.user_id !== 'string' || !hint.user_id) throw new Error('Invalid session control subject')
      // Serialize same-subject controls before any row locks. This also joins the
      // password/login protocol and avoids reciprocal deletion of held sessions.
      await tx.execute({ sql: 'SELECT 1 AS locked FROM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))', args: ['longhorn:auth-password:' + hint.user_id] })
      const row = (await tx.execute({ sql: 'SELECT token_hash,user_id,expires_at FROM longhorn_auth.lock_session_user($1)', args: [tokenHash] })).rows[0]
      if (!row || row.user_id !== hint.user_id || row.token_hash !== tokenHash) return undefined
      const instant = sessionControlTime(now())
      if (sessionControlTime(row.expires_at) <= instant) return undefined
      return (await tx.execute({ sql: `DELETE FROM longhorn_auth.sessions WHERE user_id=$1 AND expires_at>$2::bigint
        ${scope === 'others' ? 'AND token_hash<>$3' : ''}`, args: scope === 'others' ? [row.user_id, instant, tokenHash] : [row.user_id, instant] })).rowsAffected
    })
  }
}
