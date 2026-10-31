import type { Database, Migration } from '@longhornjs/database'
import { snapshotResetConfirm, snapshotResetIssue } from './password-reset.js'
import type { PasswordResetConfirm, PasswordResetIssue, PasswordResetStore } from './password-reset.js'
import { passwordTimestamp } from './password-store.js'

/** Append after the complete deployed history. */
export const sqlitePasswordResetMigrations: readonly Migration[] = [{ id: 'longhorn_auth/password_resets_001', statements: [
  `CREATE TABLE longhorn_auth_password_resets (
    token_hash TEXT PRIMARY KEY CHECK (length(token_hash)=64),
    user_id TEXT NOT NULL UNIQUE REFERENCES longhorn_auth_users(id) ON DELETE CASCADE,
    credential_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT`,
  'CREATE INDEX longhorn_auth_password_resets_expiry ON longhorn_auth_password_resets(expires_at)',
] }]

export class SqlitePasswordResetStore implements PasswordResetStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'sqlite') throw new Error('SQLite password resets require a SQLite database')
  }
  async issue(input: PasswordResetIssue): Promise<boolean> {
    const { userId, tokenHash, expiresAt } = snapshotResetIssue(input)
    return this.database.transaction(async tx => {
      const user = (await tx.execute({ sql: 'SELECT password_hash FROM longhorn_auth_users WHERE id=?', args: [userId] })).rows[0]
      if (!user) return false
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_password_resets WHERE user_id=?', args: [userId] })
      await tx.execute({ sql: 'INSERT INTO longhorn_auth_password_resets(token_hash,user_id,credential_hash,expires_at) VALUES(?,?,?,?)', args: [tokenHash, userId, user.password_hash as string, expiresAt] })
      return true
    })
  }
  async consume(input: PasswordResetConfirm, now: () => number): Promise<string | undefined> {
    const { tokenHash, nextPasswordHash } = snapshotResetConfirm(input)
    if (typeof now !== 'function') throw new Error('A password operation clock is required')
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: `SELECT r.user_id,r.credential_hash,r.expires_at,u.password_hash
        FROM longhorn_auth_password_resets r JOIN longhorn_auth_users u ON u.id=r.user_id WHERE r.token_hash=?`, args: [tokenHash] })).rows[0]
      if (!row) return undefined
      const userId = row.user_id as string
      // An unusable token is spent too, so it cannot become valid again.
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_password_resets WHERE user_id=?', args: [userId] })
      if (row.credential_hash !== row.password_hash || passwordTimestamp(row.expires_at) <= passwordTimestamp(now())) return undefined
      await tx.execute({ sql: 'UPDATE longhorn_auth_users SET password_hash=? WHERE id=?', args: [nextPasswordHash, userId] })
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE user_id=?', args: [userId] })
      return userId
    })
  }
  async prune(now: number): Promise<number> {
    const result = await this.database.execute({ sql: 'DELETE FROM longhorn_auth_password_resets WHERE expires_at<=?', args: [passwordTimestamp(now)] })
    return Number(result.rowsAffected ?? 0)
  }
}
