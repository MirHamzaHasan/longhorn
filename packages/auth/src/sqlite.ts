import type { Database, Migration, SqlRow, SqlExecutor } from '@longhorn/database'
import { assertTransactionExecutor } from '@longhorn/database/transactions'
import { normalizeUsername } from './credentials.js'
import type { TransactionalAuthStore, AuthUser, CredentialUser, StoredSession, RoleChangeResult } from './types.js'

/** Compose these with the application's other migrations and call migrate once. */
export const authMigrations: readonly Migration[] = [{
  id: 'longhorn_auth/001_users_sessions_attempts',
  statements: [
    `CREATE TABLE longhorn_auth_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, roles TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE longhorn_auth_sessions (
      token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
      user_id TEXT NOT NULL REFERENCES longhorn_auth_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT`,
    'CREATE INDEX longhorn_auth_sessions_user ON longhorn_auth_sessions(user_id)',
    'CREATE INDEX longhorn_auth_sessions_expiry ON longhorn_auth_sessions(expires_at)',
    `CREATE TABLE longhorn_auth_attempts (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT`,
    'CREATE INDEX longhorn_auth_attempts_expiry ON longhorn_auth_attempts(expires_at)',
  ],
}]

function user(row: SqlRow): AuthUser {
  if (typeof row.id !== 'string' || typeof row.username !== 'string' || typeof row.roles !== 'string') throw new Error('Invalid authentication user row')
  const roles: unknown = JSON.parse(row.roles)
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string' || !role)) throw new Error('Invalid authentication roles')
  return { id: row.id, username: row.username, roles }
}
function integer(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Invalid authentication integer')
  return number
}

export class SqliteAuthStore implements TransactionalAuthStore {
  constructor(private readonly database: Database) {}
  async createUser(input: CredentialUser): Promise<boolean> {
    const result = await this.database.execute({
      sql: 'INSERT INTO longhorn_auth_users (id, username, password_hash, roles) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING',
      args: [input.id, input.username, input.passwordHash, JSON.stringify(input.roles)],
    })
    return result.rowsAffected === 1
  }
  async findUserByUsername(username: string): Promise<CredentialUser | undefined> {
    const row = (await this.database.execute({
      sql: 'SELECT id, username, roles, password_hash FROM longhorn_auth_users WHERE username = ?', args: [username],
    })).rows[0]
    if (!row) return undefined
    if (typeof row.password_hash !== 'string') throw new Error('Invalid credential row')
    return { ...user(row), passwordHash: row.password_hash }
  }
  async findUserById(id: string): Promise<AuthUser | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT id, username, roles FROM longhorn_auth_users WHERE id = ?', args: [id] })).rows[0]
    return row ? user(row) : undefined
  }
  async readAuthenticationInTransaction(tx: SqlExecutor, hash: string) {
    assertTransactionExecutor(tx, this.database)
    const row = (await tx.execute({ sql: `SELECT u.id,u.username,u.roles,s.token_hash,s.user_id,s.expires_at
      FROM longhorn_auth_users u JOIN longhorn_auth_sessions s ON s.user_id=u.id WHERE s.token_hash=?`, args: [hash] })).rows[0]
    return row ? { user: user(row), session: { tokenHash: String(row.token_hash), userId: String(row.user_id), expiresAt: integer(row.expires_at) } } : undefined
  }
  /** Trusted provisioning only; no public registration/login path invokes it. */
  async setUserRole(username: string, role: string, enabled: boolean): Promise<RoleChangeResult> {
    const normalized = normalizeUsername(username)
    if (!/^[a-z][a-z0-9._:-]{0,99}$/.test(role) || typeof enabled !== 'boolean') throw new Error('Invalid role change')
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: 'SELECT id,username,roles FROM longhorn_auth_users WHERE username=?', args: [normalized] })).rows[0]
      if (!row) return { status: 'missing' }
      const current = user(row)
      if (current.roles.includes(role) === enabled) return { status: 'unchanged', user: current, revokedSessions: 0 }
      const roles = enabled ? [...current.roles,role] : current.roles.filter(value => value !== role)
      await tx.execute({ sql: 'UPDATE longhorn_auth_users SET roles=? WHERE id=?', args: [JSON.stringify(roles), current.id] })
      const deleted = await tx.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE user_id=?', args: [current.id] })
      return { status: 'updated', user: { ...current, roles }, revokedSessions: deleted.rowsAffected }
    })
  }
  async createSession(session: StoredSession, previousHash?: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.execute({ sql: 'INSERT INTO longhorn_auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        args: [session.tokenHash, session.userId, session.expiresAt] })
      if (previousHash) await tx.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE token_hash = ?', args: [previousHash] })
    })
  }
  async findSession(hash: string): Promise<StoredSession | undefined> {
    const row = (await this.database.execute({
      sql: 'SELECT token_hash, user_id, expires_at FROM longhorn_auth_sessions WHERE token_hash = ?', args: [hash],
    })).rows[0]
    if (!row) return undefined
    if (typeof row.token_hash !== 'string' || typeof row.user_id !== 'string') throw new Error('Invalid authentication session row')
    return { tokenHash: row.token_hash, userId: row.user_id, expiresAt: integer(row.expires_at) }
  }
  async deleteSession(hash: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE token_hash = ?', args: [hash] })
  }
  async deleteUserSessions(id: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE user_id = ?', args: [id] })
  }
  async deleteExpiredSessions(now: number): Promise<number> {
    return (await this.database.execute({ sql: 'DELETE FROM longhorn_auth_sessions WHERE expires_at <= ?', args: [now] })).rowsAffected
  }
  async consumeLoginAttempt(key: string, now: number, limit: number, windowMs: number): Promise<number | undefined> {
    return this.database.transaction(async (tx) => {
      await tx.execute({ sql: 'DELETE FROM longhorn_auth_attempts WHERE expires_at <= ?', args: [now] })
      const row = (await tx.execute({
        sql: `INSERT INTO longhorn_auth_attempts (key, attempts, expires_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET attempts = MIN(attempts + 1, ?) RETURNING attempts, expires_at`,
        args: [key, now + windowMs, limit + 1],
      })).rows[0]
      if (!row) throw new Error('Login attempt reservation failed')
      return integer(row.attempts) > limit ? integer(row.expires_at) : undefined
    })
  }
  async clearLoginAttempts(key: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth_attempts WHERE key = ?', args: [key] })
  }
}
