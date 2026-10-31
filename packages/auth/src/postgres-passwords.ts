import type { Database, Migration, SqlExecutor } from '@longhornjs/database'
import type { PasswordChangeInput, PasswordChangeStore, PasswordSessionInput } from './types.js'
import { passwordTimestamp, snapshotPasswordChange, snapshotPasswordSession } from './password-store.js'

async function assertPasswordIsolation(tx: SqlExecutor): Promise<void> {
  const row = (await tx.execute("SELECT pg_catalog.current_setting('transaction_isolation') AS isolation")).rows[0]
  // A repeatable snapshot taken before advisory-lock admission could retain an old hash.
  if (row?.isolation !== 'read committed') throw new Error('Password operations require READ COMMITTED isolation')
}

export const postgresPasswordFunctions = Object.freeze([
  'longhorn_auth.lock_password_change(text,text)',
  'longhorn_auth.replace_password(text,text,text,text,bigint,text)',
])
export async function checkPostgresPasswordFunctions(database: Database): Promise<void> {
  for (const signature of postgresPasswordFunctions) {
    const row = (await database.execute({ sql: "SELECT pg_catalog.has_function_privilege(current_user,$1,'EXECUTE') AS allowed", args: [signature] })).rows[0]
    if (row?.allowed !== true) throw new Error('Password change functions must be deployed and granted')
  }
}

/** Append to the complete deployed history; original auth/operations migrations stay unchanged. */
export const postgresPasswordMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_auth/003_password_changes', statements: [
  `CREATE FUNCTION longhorn_auth.lock_password_change(input_user_id text,input_token_hash text)
    RETURNS TABLE(password_hash text,expires_at bigint)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    BEGIN
      IF input_user_id IS NULL OR input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('longhorn:auth-password:'||input_user_id,0));
      PERFORM u.id FROM longhorn_auth.users u WHERE u.id=input_user_id FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
      RETURN QUERY SELECT u.password_hash,s.expires_at FROM longhorn_auth.users u
        JOIN longhorn_auth.sessions s ON s.user_id=u.id
        WHERE u.id=input_user_id AND s.token_hash=input_token_hash FOR UPDATE OF s;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.lock_password_change(text,text) FROM PUBLIC',
  `CREATE FUNCTION longhorn_auth.replace_password(input_user_id text,input_token_hash text,input_expected_hash text,
    input_next_hash text,input_now bigint,input_attempt_key text)
    RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE current_hash text; session_expiry bigint;
    BEGIN
      IF input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$'
        OR input_next_hash IS NULL OR length(input_next_hash)=0
        OR input_now IS NULL OR input_now NOT BETWEEN 0 AND 9007199254740991
        OR input_attempt_key IS NULL OR input_attempt_key !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('longhorn:auth-password:'||input_user_id,0));
      SELECT u.password_hash INTO current_hash FROM longhorn_auth.users u WHERE u.id=input_user_id FOR UPDATE;
      IF NOT FOUND OR current_hash COLLATE "C" IS DISTINCT FROM input_expected_hash COLLATE "C" THEN RETURN false; END IF;
      SELECT s.expires_at INTO session_expiry FROM longhorn_auth.sessions s
        WHERE s.token_hash=input_token_hash AND s.user_id=input_user_id FOR UPDATE;
      IF NOT FOUND OR session_expiry<=input_now THEN RETURN false; END IF;
      UPDATE longhorn_auth.users SET password_hash=input_next_hash WHERE id=input_user_id;
      DELETE FROM longhorn_auth.sessions WHERE user_id=input_user_id;
      DELETE FROM longhorn_auth.attempts WHERE key=input_attempt_key;
      RETURN true;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.replace_password(text,text,text,text,bigint,text) FROM PUBLIC',
] }]

/** Same borrowed database as PostgresAuthStore; callers explicitly deploy/grant the opt-in functions. */
export class PostgresPasswordStore implements PasswordChangeStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL passwords require a PostgreSQL database')
  }
  async createSession(value: PasswordSessionInput): Promise<boolean> {
    const { session, previousHash, expectedPasswordHash, attemptKey } = snapshotPasswordSession(value)
    return this.database.transaction(async tx => {
      await assertPasswordIsolation(tx)
      // Built-in transaction locks require no user UPDATE grant or opt-in schema.
      await tx.execute({ sql: 'SELECT 1 AS locked FROM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended($1,0))', args: ['longhorn:auth-password:' + session.userId] })
      const user = (await tx.execute({ sql: 'SELECT password_hash FROM longhorn_auth.users WHERE id=$1', args: [session.userId] })).rows[0]
      if (!user || user.password_hash !== expectedPasswordHash) return false
      await tx.execute({ sql: 'INSERT INTO longhorn_auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', args: [session.tokenHash, session.userId, session.expiresAt] })
      if (previousHash !== undefined) await tx.execute({ sql: 'DELETE FROM longhorn_auth.sessions WHERE token_hash=$1', args: [previousHash] })
      await tx.execute({ sql: 'DELETE FROM longhorn_auth.attempts WHERE key=$1', args: [attemptKey] })
      return true
    })
  }
  async replacePassword(value: PasswordChangeInput, now: () => number): Promise<boolean> {
    const { userId, tokenHash, expectedPasswordHash, nextPasswordHash, attemptKey } = snapshotPasswordChange(value)
    if (typeof now !== 'function') throw new Error('A password operation clock is required')
    return this.database.transaction(async tx => {
      await assertPasswordIsolation(tx)
      const locked = (await tx.execute({ sql: 'SELECT password_hash,expires_at FROM longhorn_auth.lock_password_change($1,$2)', args: [userId, tokenHash] })).rows[0]
      if (!locked || locked.password_hash !== expectedPasswordHash) return false
      const instant = passwordTimestamp(now())
      if (passwordTimestamp(locked.expires_at) <= instant) return false
      const row = (await tx.execute({ sql: 'SELECT longhorn_auth.replace_password($1,$2,$3,$4,$5::bigint,$6) AS accepted',
        args: [userId, tokenHash, expectedPasswordHash, nextPasswordHash, instant, attemptKey] })).rows[0]
      if (typeof row?.accepted !== 'boolean') throw new Error('Invalid password change result')
      return row.accepted
    })
  }
}
