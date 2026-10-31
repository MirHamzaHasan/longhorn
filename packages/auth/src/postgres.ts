import type { Database, Migration, SqlRow, SqlExecutor } from '@longhornjs/database'
import { assertTransactionExecutor } from '@longhornjs/database/transactions'
import { PostgresSessionControlStore } from './postgres-session-controls.js'
import { normalizeUsername } from './credentials.js'
import { PostgresPasswordStore } from './postgres-passwords.js'
import type { TransactionalAuthStore, AuthUser, CredentialUser, StoredSession, RoleChangeResult } from './types.js'

/** Append once to the application's complete owner-deployed PostgreSQL history. */
export const postgresAuthMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_auth/001_users_sessions_attempts', statements: [
  'CREATE SCHEMA IF NOT EXISTS longhorn_auth',
  `CREATE TABLE longhorn_auth.users (
    id text PRIMARY KEY CHECK (char_length(id)>0),
    username text COLLATE "C" NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
    password_hash text NOT NULL CHECK (char_length(password_hash)>0),
    roles jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(roles)='array')
  )`,
  `CREATE TABLE longhorn_auth.sessions (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    user_id text NOT NULL REFERENCES longhorn_auth.users(id) ON DELETE CASCADE,
    expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
  )`,
  'CREATE INDEX sessions_user ON longhorn_auth.sessions(user_id)',
  'CREATE INDEX sessions_expiry ON longhorn_auth.sessions(expires_at)',
  `CREATE TABLE longhorn_auth.attempts (
    key text PRIMARY KEY,attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 1001),
    expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
  )`,
  'CREATE INDEX attempts_expiry ON longhorn_auth.attempts(expires_at,key)',
] }]

/** Opt-in privileged lock projection; append after the application's complete deployed history. */
export const postgresAuthTransactionMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_auth/002_transaction_auth', statements: [
  `CREATE FUNCTION longhorn_auth.lock_session_user(input_token_hash text)
    RETURNS TABLE(id text,username text,roles jsonb,token_hash text,user_id text,expires_at bigint)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE subject_id text;
    BEGIN
      IF input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
      SELECT s.user_id INTO subject_id FROM longhorn_auth.sessions s WHERE s.token_hash=input_token_hash;
      IF NOT FOUND THEN RETURN; END IF;
      PERFORM u.id FROM longhorn_auth.users u WHERE u.id=subject_id FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;
      RETURN QUERY SELECT u.id,u.username,u.roles,s.token_hash,s.user_id,s.expires_at
        FROM longhorn_auth.users u JOIN longhorn_auth.sessions s ON s.user_id=u.id
        WHERE u.id=subject_id AND s.token_hash=input_token_hash FOR SHARE OF s;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.lock_session_user(text) FROM PUBLIC',
] }]

function integer(value: unknown): number {
  const result = typeof value==='bigint' ? Number(value) : value
  if (typeof result!=='number' || !Number.isSafeInteger(result)) throw new Error('Invalid PostgreSQL authentication integer')
  return result
}
function text(value: unknown): string { if (typeof value!=='string') throw new Error('Invalid PostgreSQL authentication text');return value }
function user(row: SqlRow): AuthUser {
  const roles: unknown=JSON.parse(text(row.roles))
  if (!Array.isArray(roles) || roles.some(role => typeof role!=='string' || !role)) throw new Error('Invalid PostgreSQL authentication roles')
  return { id: text(row.id),username: text(row.username),roles }
}
function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value<0) throw new Error('Invalid PostgreSQL authentication timestamp')
  return value
}

/** Borrows a PostgreSQL database. Password/token policy and connection ownership remain outside this store. */
export class PostgresAuthStore implements TransactionalAuthStore {
  readonly sessionControls: PostgresSessionControlStore
  readonly passwordChanges: PostgresPasswordStore
  constructor(private readonly database: Database) {
    if (database.dialect!==undefined && database.dialect!=='postgres') throw new Error('PostgreSQL auth requires a PostgreSQL database')
    this.sessionControls = new PostgresSessionControlStore(database)
    this.passwordChanges = new PostgresPasswordStore(database)
  }
  async createUser(input: CredentialUser): Promise<boolean> {
    return (await this.database.execute({ sql: `INSERT INTO longhorn_auth.users(id,username,password_hash,roles)
      VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(username) DO NOTHING`,
    args: [input.id,input.username,input.passwordHash,JSON.stringify(input.roles)] })).rowsAffected===1
  }
  async findUserByUsername(username: string): Promise<CredentialUser | undefined> {
    const row=(await this.database.execute({ sql: 'SELECT id,username,roles,password_hash FROM longhorn_auth.users WHERE username=$1',args: [username] })).rows[0]
    return row ? { ...user(row),passwordHash: text(row.password_hash) } : undefined
  }
  async findUserById(id: string): Promise<AuthUser | undefined> {
    const row=(await this.database.execute({ sql: 'SELECT id,username,roles FROM longhorn_auth.users WHERE id=$1',args: [id] })).rows[0]
    return row ? user(row) : undefined
  }
  async readAuthenticationInTransaction(tx: SqlExecutor, hash: string) {
    assertTransactionExecutor(tx, this.database)
    const row = (await tx.execute({ sql: 'SELECT id,username,roles,token_hash,user_id,expires_at FROM longhorn_auth.lock_session_user($1)', args: [hash] })).rows[0]
    return row ? { user: user(row), session: { tokenHash: text(row.token_hash), userId: text(row.user_id), expiresAt: integer(row.expires_at) } } : undefined
  }
  /** Uses privileged credentials; role change and existing-session revocation commit together. */
  async setUserRole(username: string, role: string, enabled: boolean): Promise<RoleChangeResult> {
    const normalized = normalizeUsername(username)
    if (!/^[a-z][a-z0-9._:-]{0,99}$/.test(role) || typeof enabled !== 'boolean') throw new Error('Invalid role change')
    return this.database.transaction(async tx => {
      const row = (await tx.execute({ sql: 'SELECT id,username,roles FROM longhorn_auth.users WHERE username=$1 FOR UPDATE', args: [normalized] })).rows[0]
      if (!row) return { status: 'missing' }
      const current = user(row)
      if (current.roles.includes(role) === enabled) return { status: 'unchanged', user: current, revokedSessions: 0 }
      const roles = enabled ? [...current.roles,role] : current.roles.filter(value => value !== role)
      await tx.execute({ sql: 'UPDATE longhorn_auth.users SET roles=$1::jsonb WHERE id=$2', args: [JSON.stringify(roles),current.id] })
      const deleted = await tx.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE user_id=$1', args: [current.id] })
      return { status: 'updated', user: { ...current,roles }, revokedSessions: deleted.rowsAffected }
    })
  }
  async createSession(session: StoredSession,previousHash?: string): Promise<void> {
    await this.database.transaction(async tx => {
      await tx.execute({ sql: 'INSERT INTO longhorn_auth.sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)',args: [session.tokenHash,session.userId,timestamp(session.expiresAt)] })
      if (previousHash!==undefined) await tx.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE token_hash=$1',args: [previousHash] })
    })
  }
  async findSession(hash: string): Promise<StoredSession | undefined> {
    const row=(await this.database.execute({ sql: 'SELECT token_hash,user_id,expires_at FROM longhorn_auth.sessions WHERE token_hash=$1',args: [hash] })).rows[0]
    return row ? { tokenHash: text(row.token_hash),userId: text(row.user_id),expiresAt: integer(row.expires_at) } : undefined
  }
  async deleteSession(hash: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE token_hash=$1',args: [hash] })
  }
  async deleteUserSessions(id: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE user_id=$1',args: [id] })
  }
  async deleteExpiredSessions(now: number): Promise<number> {
    return (await this.database.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE expires_at<=$1::bigint',args: [timestamp(now)] })).rowsAffected
  }
  async consumeLoginAttempt(key: string,now: number,limit: number,windowMs: number): Promise<number | undefined> {
    timestamp(now);timestamp(now+windowMs)
    if (!Number.isSafeInteger(limit) || limit<1 || limit>1000 || !Number.isSafeInteger(windowMs) || windowMs<1000 || windowMs>86_400_000) throw new Error('Invalid PostgreSQL login attempt policy')
    // One conflicting-key upsert serializes reservations; no process-wide cleanup scan on login.
    const row=(await this.database.execute({ sql: `INSERT INTO longhorn_auth.attempts AS counter(key,attempts,expires_at)
      VALUES ($1,1,$4) ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN counter.expires_at<=$2::bigint THEN 1 ELSE LEAST(counter.attempts+1,$3::integer+1) END,
      expires_at=CASE WHEN counter.expires_at<=$2::bigint THEN $4::bigint ELSE counter.expires_at END
      RETURNING attempts,expires_at`,args: [key,now,limit,now+windowMs] })).rows[0]
    if (!row) throw new Error('PostgreSQL login attempt reservation returned no row')
    return integer(row.attempts)>limit ? integer(row.expires_at) : undefined
  }
  async clearLoginAttempts(key: string): Promise<void> {
    await this.database.execute({ sql: 'DELETE FROM longhorn_auth.attempts WHERE key=$1',args: [key] })
  }
  /** Explicit bounded maintenance; no timer or automatic cleanup is installed by the store. */
  async deleteExpiredLoginAttempts(now: number,limit=1000): Promise<number> {
    timestamp(now)
    if (!Number.isSafeInteger(limit) || limit<1 || limit>10_000) throw new Error('Invalid PostgreSQL login attempt cleanup limit')
    return (await this.database.execute({ sql: `WITH expired AS (
      SELECT key FROM longhorn_auth.attempts WHERE expires_at<=$1::bigint ORDER BY expires_at,key LIMIT $2 FOR UPDATE SKIP LOCKED
    ) DELETE FROM longhorn_auth.attempts AS counter USING expired WHERE counter.key=expired.key`,args: [now,limit] })).rowsAffected
  }
}
export { PostgresPasswordResetStore, postgresPasswordResetMigrations, postgresPasswordResetFunctions, checkPostgresPasswordResetFunctions } from './postgres-password-reset.js'
