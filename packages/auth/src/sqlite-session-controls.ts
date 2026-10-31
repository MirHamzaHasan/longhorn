import type { Database } from '@longhornjs/database'
import type { SessionControlInput, SessionControlStore } from './types.js'
import { sessionControlTime, snapshotSessionControl } from './session-control.js'

/** Same borrowed database and existing auth schema; ownership covers reauthentication and deletion. */
export class SqliteSessionControlStore implements SessionControlStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'sqlite') throw new Error('SQLite session controls require a SQLite database')
  }
  async revoke(value: SessionControlInput, now: () => number): Promise<number | undefined> {
    const { tokenHash, scope } = snapshotSessionControl(value)
    if (typeof now !== 'function') throw new Error('A session control clock is required')
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: `SELECT s.user_id,s.expires_at FROM longhorn_auth_sessions s
        JOIN longhorn_auth_users u ON u.id=s.user_id WHERE s.token_hash=?`, args: [tokenHash] })).rows[0]
      if (!row) return undefined
      if (typeof row.user_id !== 'string' || !row.user_id) throw new Error('Invalid session control subject')
      const instant = sessionControlTime(now())
      if (sessionControlTime(row.expires_at) <= instant) return undefined
      return (await tx.execute({ sql: `DELETE FROM longhorn_auth_sessions WHERE user_id=? AND expires_at>?
        ${scope === 'others' ? 'AND token_hash<>?' : ''}`, args: scope === 'others' ? [row.user_id, instant, tokenHash] : [row.user_id, instant] })).rowsAffected
    })
  }
}
