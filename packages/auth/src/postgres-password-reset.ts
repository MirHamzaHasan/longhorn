import type { Database, Migration, SqlExecutor } from '@longhornjs/database'
import { snapshotResetConfirm, snapshotResetIssue } from './password-reset.js'
import type { PasswordResetConfirm, PasswordResetIssue, PasswordResetStore } from './password-reset.js'
import { passwordTimestamp } from './password-store.js'

async function assertIsolation(tx: SqlExecutor): Promise<void> {
  const row = (await tx.execute("SELECT pg_catalog.current_setting('transaction_isolation') AS isolation")).rows[0]
  if (row?.isolation !== 'read committed') throw new Error('Password operations require READ COMMITTED isolation')
}

export const postgresPasswordResetFunctions = Object.freeze([
  'longhorn_auth.issue_password_reset(text,text,bigint)',
  'longhorn_auth.lock_password_reset(text)',
  'longhorn_auth.consume_password_reset(text,text,bigint)',
  'longhorn_auth.prune_password_resets(bigint)',
])
export async function checkPostgresPasswordResetFunctions(database: Database): Promise<void> {
  for (const signature of postgresPasswordResetFunctions) {
    const row = (await database.execute({ sql: "SELECT pg_catalog.has_function_privilege(current_user,$1,'EXECUTE') AS allowed", args: [signature] })).rows[0]
    if (row?.allowed !== true) throw new Error('Password reset functions must be deployed and granted')
  }
}

/** Append after the complete deployed history. The runtime role gets EXECUTE only, never the table.
 * These take the same exclusive per-user lock as password replacement and session issuance. */
export const postgresPasswordResetMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_auth/password_resets_001', statements: [
  `CREATE TABLE longhorn_auth.password_resets (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    user_id text NOT NULL UNIQUE REFERENCES longhorn_auth.users(id) ON DELETE CASCADE,
    credential_hash text NOT NULL,
    expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
  )`,
  'CREATE INDEX password_resets_expiry ON longhorn_auth.password_resets(expires_at)',
  'REVOKE ALL ON longhorn_auth.password_resets FROM PUBLIC',
  `CREATE FUNCTION longhorn_auth.issue_password_reset(input_user_id text,input_token_hash text,input_expires_at bigint)
    RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE current_hash text;
    BEGIN
      IF input_user_id IS NULL OR input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$'
        OR input_expires_at IS NULL OR input_expires_at NOT BETWEEN 0 AND 9007199254740991 THEN RETURN false; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('longhorn:auth-password:'||input_user_id,0));
      SELECT u.password_hash INTO current_hash FROM longhorn_auth.users u WHERE u.id=input_user_id FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      DELETE FROM longhorn_auth.password_resets WHERE user_id=input_user_id;
      INSERT INTO longhorn_auth.password_resets(token_hash,user_id,credential_hash,expires_at)
        VALUES(input_token_hash,input_user_id,current_hash,input_expires_at);
      RETURN true;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.issue_password_reset(text,text,bigint) FROM PUBLIC',
  `CREATE FUNCTION longhorn_auth.lock_password_reset(input_token_hash text)
    RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE owner_id text;
    BEGIN
      IF input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
      SELECT r.user_id INTO owner_id FROM longhorn_auth.password_resets r WHERE r.token_hash=input_token_hash;
      IF NOT FOUND THEN RETURN false; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('longhorn:auth-password:'||owner_id,0));
      RETURN true;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.lock_password_reset(text) FROM PUBLIC',
  `CREATE FUNCTION longhorn_auth.consume_password_reset(input_token_hash text,input_next_hash text,input_now bigint)
    RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE owner_id text; bound_hash text; expiry bigint; current_hash text;
    BEGIN
      IF input_token_hash IS NULL OR input_token_hash !~ '^[a-f0-9]{64}$' OR input_next_hash IS NULL OR length(input_next_hash)=0
        OR input_now IS NULL OR input_now NOT BETWEEN 0 AND 9007199254740991 THEN RETURN NULL; END IF;
      SELECT r.user_id,r.credential_hash,r.expires_at INTO owner_id,bound_hash,expiry
        FROM longhorn_auth.password_resets r WHERE r.token_hash=input_token_hash FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT u.password_hash INTO current_hash FROM longhorn_auth.users u WHERE u.id=owner_id FOR UPDATE;
      DELETE FROM longhorn_auth.password_resets WHERE user_id=owner_id;
      IF current_hash COLLATE "C" IS DISTINCT FROM bound_hash COLLATE "C" OR expiry<=input_now THEN RETURN NULL; END IF;
      UPDATE longhorn_auth.users SET password_hash=input_next_hash WHERE id=owner_id;
      DELETE FROM longhorn_auth.sessions WHERE user_id=owner_id;
      RETURN owner_id;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.consume_password_reset(text,text,bigint) FROM PUBLIC',
  `CREATE FUNCTION longhorn_auth.prune_password_resets(input_now bigint)
    RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
    DECLARE removed bigint;
    BEGIN
      IF input_now IS NULL OR input_now NOT BETWEEN 0 AND 9007199254740991 THEN RETURN 0; END IF;
      DELETE FROM longhorn_auth.password_resets WHERE expires_at<=input_now;
      GET DIAGNOSTICS removed = ROW_COUNT;
      RETURN removed;
    END $body$`,
  'REVOKE ALL ON FUNCTION longhorn_auth.prune_password_resets(bigint) FROM PUBLIC',
] }]

export class PostgresPasswordResetStore implements PasswordResetStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL password resets require a PostgreSQL database')
  }
  async issue(input: PasswordResetIssue): Promise<boolean> {
    const { userId, tokenHash, expiresAt } = snapshotResetIssue(input)
    const row = (await this.database.execute({ sql: 'SELECT longhorn_auth.issue_password_reset($1,$2,$3::bigint) AS issued', args: [userId, tokenHash, expiresAt] })).rows[0]
    if (typeof row?.issued !== 'boolean') throw new Error('Invalid password reset result')
    return row.issued
  }
  async consume(input: PasswordResetConfirm, now: () => number): Promise<string | undefined> {
    const { tokenHash, nextPasswordHash } = snapshotResetConfirm(input)
    if (typeof now !== 'function') throw new Error('A password operation clock is required')
    return this.database.transaction(async tx => {
      await assertIsolation(tx)
      const locked = (await tx.execute({ sql: 'SELECT longhorn_auth.lock_password_reset($1) AS locked', args: [tokenHash] })).rows[0]
      if (locked?.locked !== true) return undefined
      // The clock is read after the lock, so waiting for it cannot stretch a token's lifetime.
      const instant = passwordTimestamp(now())
      const row = (await tx.execute({ sql: 'SELECT longhorn_auth.consume_password_reset($1,$2,$3::bigint) AS user_id', args: [tokenHash, nextPasswordHash, instant] })).rows[0]
      return typeof row?.user_id === 'string' ? row.user_id : undefined
    })
  }
  async prune(now: number): Promise<number> {
    const row = (await this.database.execute({ sql: 'SELECT longhorn_auth.prune_password_resets($1::bigint) AS removed', args: [passwordTimestamp(now)] })).rows[0]
    return Number(row?.removed ?? 0)
  }
}
