import type { Database } from '@longhorn/database'
import type { PasswordChangeInput, PasswordChangeStore, PasswordSessionInput } from './types.js'
import { passwordTimestamp, snapshotPasswordChange, snapshotPasswordSession } from './password-store.js'

/** Borrows the same database as SqliteAuthStore. No new schema or connection is acquired. */
export class SqlitePasswordStore implements PasswordChangeStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'sqlite') throw new Error('SQLite passwords require a SQLite database')
  }
  async createSession(value: PasswordSessionInput): Promise<boolean> {
    const { session, previousHash, expectedPasswordHash, attemptKey } = snapshotPasswordSession(value)
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: 'SELECT password_hash FROM longhorn_auth_users WHERE id=?', args: [session.userId] })).rows[0]
      if (!row || row.password_hash !== expectedPasswordHash) return false
      await tx.execute({ sql: 'INSERT INTO longhorn_auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', args: [session.tokenHash, session.userId, session.expiresAt] })
      if (previousHash !== undefined) await tx.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE token_hash=?', args: [previousHash] })
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_attempts WHERE key=?', args: [attemptKey] })
      return true
    })
  }
  async replacePassword(value: PasswordChangeInput, now: () => number): Promise<boolean> {
    const { userId, tokenHash, expectedPasswordHash, nextPasswordHash, attemptKey } = snapshotPasswordChange(value)
    if (typeof now !== 'function') throw new Error('A password operation clock is required')
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: `SELECT u.password_hash,s.expires_at
        FROM longhorn_auth_users u JOIN longhorn_auth_sessions s ON s.user_id=u.id
        WHERE u.id=? AND s.token_hash=?`, args: [userId, tokenHash] })).rows[0]
      if (!row || row.password_hash !== expectedPasswordHash) return false
      if (passwordTimestamp(row.expires_at) <= passwordTimestamp(now())) return false
      await tx.execute({ sql: 'UPDATE longhorn_auth_users SET password_hash=? WHERE id=?', args: [nextPasswordHash, userId] })
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE user_id=?', args: [userId] })
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_attempts WHERE key=?', args: [attemptKey] })
      return true
    })
  }
}
