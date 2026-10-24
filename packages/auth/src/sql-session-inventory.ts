import type { Database, SqlExecutor, SqlRow } from '@longhorn/database'
import { AuthError } from './credentials.js'
import { sessionControlTime } from './session-control.js'
import { validSessionPosition, validSessionReference } from './session-inventory.js'
import type { SessionEntry, SessionInventoryStore, SessionPosition, SessionRevocation, StoredSessionPage } from './session-inventory.js'
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export class SqlSessionInventoryStore implements SessionInventoryStore {
  constructor(private readonly database: Database, private readonly dialect: 'sqlite' | 'postgres') {
    if (database.dialect !== undefined && database.dialect !== dialect) throw new Error('Session inventory requires its matching database')
  }
  private async subject(tx: SqlExecutor, tokenHash: string, now: () => number): Promise<{ owner: string; initiator: string; instant: number } | undefined> {
    let row: SqlRow | undefined
    if (this.dialect === 'postgres') {
      if ((await tx.execute("SELECT pg_catalog.current_setting('transaction_isolation') AS isolation")).rows[0]?.isolation !== 'read committed') throw new Error('Session inventory requires READ COMMITTED isolation')
      const hint = (await tx.execute({ sql: 'SELECT user_id FROM longhorn_auth.sessions WHERE token_hash=$1', args: [tokenHash] })).rows[0]
      if (!hint) return undefined
      if (typeof hint.user_id !== 'string' || !hint.user_id) throw new Error('Invalid session inventory owner')
      await tx.execute({ sql: 'SELECT 1 AS locked FROM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))', args: ['longhorn:auth-password:' + hint.user_id] })
      row = (await tx.execute({ sql: 'SELECT locked.token_hash,locked.user_id,locked.expires_at,s.session_id FROM longhorn_auth.lock_session_user($1) locked JOIN longhorn_auth.sessions s ON s.token_hash=locked.token_hash', args: [tokenHash] })).rows[0]
      if (!row || row.token_hash !== tokenHash || row.user_id !== hint.user_id) return undefined
    } else row = (await tx.execute({ sql: `SELECT s.user_id,s.expires_at,s.session_id FROM longhorn_auth_sessions s JOIN longhorn_auth_users u ON u.id=s.user_id WHERE s.token_hash=?`, args: [tokenHash] })).rows[0]
    if (!row) return undefined
    if (typeof row.user_id !== 'string' || !row.user_id || new TextEncoder().encode(row.user_id).byteLength > 256 || !validSessionReference(row.session_id)) throw new Error('Invalid session inventory owner')
    const instant = sessionControlTime(now())
    return sessionControlTime(row.expires_at) > instant ? { owner: row.user_id, initiator: row.session_id, instant } : undefined
  }
  async list(value: Readonly<{ tokenHash: string; limit: number; after: SessionPosition | null }>, now: () => number): Promise<StoredSessionPage | undefined> {
    const tokenHash = value.tokenHash, limit = value.limit, after = value.after ? Object.freeze({ ...value.after }) : null
    if (!hash(tokenHash) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (after && !validSessionPosition(after)) || typeof now !== 'function') throw new Error('Invalid session inventory input')
    const pg = this.dialect === 'postgres', table = pg ? 'longhorn_auth.sessions' : 'longhorn_auth_sessions'
    return this.database.transaction(async tx => {
      const subject = await this.subject(tx, tokenHash, now); if (!subject) return undefined
      if (after && (after.owner !== subject.owner || after.initiator !== subject.initiator)) throw new AuthError('INVALID_INPUT')
      const args = [tokenHash, subject.owner, subject.instant, ...(after ? [after.expiresAt, after.id] : []), limit + 1]
      const rows = (await tx.execute({ sql: `SELECT session_id,expires_at,(token_hash=${pg ? '$1' : '?'}) AS current FROM ${table}
        WHERE user_id=${pg ? '$2' : '?'} AND expires_at>${pg ? '$3' : '?'}
        ${after ? `AND (expires_at,session_id)>(${pg ? '$4,$5' : '?,?'})` : ''}
        ORDER BY expires_at,session_id LIMIT ${pg ? '$' + args.length : '?'}`, args })).rows
      const entries: SessionEntry[] = rows.map(row => {
        if (!validSessionReference(row.session_id) || ![true, false, 0, 1, 0n, 1n].includes(row.current as never)) throw new Error('Invalid session inventory row')
        return Object.freeze({ id: row.session_id, expiresAt: sessionControlTime(row.expires_at), current: row.current === true || row.current === 1 || row.current === 1n })
      })
      const sessions = Object.freeze(entries.slice(0, limit)), last = sessions.at(-1)
      return Object.freeze({ sessions, next: entries.length > limit && last ? Object.freeze({ owner: subject.owner, initiator: subject.initiator, id: last.id, expiresAt: last.expiresAt }) : null })
    })
  }
  async revoke(value: Readonly<{ tokenHash: string; id: string }>, now: () => number): Promise<SessionRevocation | undefined> {
    const { tokenHash, id } = value
    if (!hash(tokenHash) || !validSessionReference(id) || typeof now !== 'function') throw new Error('Invalid session inventory input')
    const pg = this.dialect === 'postgres', table = pg ? 'longhorn_auth.sessions' : 'longhorn_auth_sessions'
    return this.database.transaction(async tx => {
      const subject = await this.subject(tx, tokenHash, now); if (!subject) return undefined
      const result = await tx.execute({ sql: `DELETE FROM ${table} WHERE user_id=${pg ? '$1' : '?'} AND session_id=${pg ? '$2' : '?'} AND expires_at>${pg ? '$3' : '?'} RETURNING (token_hash=${pg ? '$4' : '?'}) AS current`, args: [subject.owner, id, subject.instant, tokenHash] })
      if (result.rows.length === 0) return Object.freeze({ revokedSessions: 0, current: false })
      // RETURNING is authoritative; native libsql can report rowsAffected=0 for a returned deletion.
      const marker = result.rows[0]?.current
      if (result.rows.length !== 1 || ![true, false, 0, 1, 0n, 1n].includes(marker as never)) throw new Error('Invalid session inventory deletion')
      return Object.freeze({ revokedSessions: 1, current: marker === true || marker === 1 || marker === 1n })
    })
  }
}
