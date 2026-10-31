import type { Database, Migration, SqlExecutor, SqlRow } from '@longhornjs/database'
import { assertTransactionExecutor } from '@longhornjs/database/transactions'
import type { Claim, FailJob, JobFailure, JobState, NewJob, Ownership, QueueStore, StoredJob } from './types.js'

/** Append to the application's complete migration history; do not migrate independently. */
export const queueMigrations: readonly Migration[] = [{
  id: 'longhorn_queue/001_jobs',
  statements: [
    `CREATE TABLE longhorn_queue_jobs (
      queue TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed')),
      attempts INTEGER NOT NULL CHECK (attempts >= 0), max_attempts INTEGER NOT NULL CHECK (max_attempts > 0 AND attempts <= max_attempts),
      available_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      lease_token TEXT, lease_until INTEGER,
      last_failure TEXT CHECK (last_failure IN ('handler','invalid-payload','lease-expired')),
      PRIMARY KEY (queue, id),
      CHECK ((state = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
        OR (state <> 'running' AND lease_token IS NULL AND lease_until IS NULL))
    ) STRICT`,
    "CREATE INDEX longhorn_queue_ready ON longhorn_queue_jobs(queue, available_at, created_at, id) WHERE state = 'pending'",
    "CREATE INDEX longhorn_queue_expired ON longhorn_queue_jobs(queue, lease_until) WHERE state = 'running'",
  ],
}]

function integer(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Invalid queue integer')
  return number
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid queue text'); return value }
function job(row: SqlRow): StoredJob {
  return { id: text(row.id), queue: text(row.queue), payload: text(row.payload), state: text(row.state) as JobState,
    attempts: integer(row.attempts), maxAttempts: integer(row.max_attempts),
    availableAt: integer(row.available_at), createdAt: integer(row.created_at), updatedAt: integer(row.updated_at),
    leaseToken: row.lease_token === null ? null : text(row.lease_token),
    leaseUntil: row.lease_until === null ? null : integer(row.lease_until),
    lastFailure: row.last_failure === null ? null : text(row.last_failure) as JobFailure }
}
const owned = "queue = ? AND id = ? AND state = 'running' AND lease_token = ? AND lease_until > ?"
const ownershipArgs = (input: Ownership) => [input.queue, input.id, input.token, input.now] as const

/** Insert through an existing executor/transaction. Caller owns input validation and commit. */
export async function insertSqliteJob(executor: SqlExecutor, input: NewJob): Promise<StoredJob> {
  if (executor.dialect !== undefined && executor.dialect !== 'sqlite') throw new Error('SQLite queue requires a SQLite executor')
  const row = (await executor.execute({
    sql: `INSERT INTO longhorn_queue_jobs
      (queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at)
      VALUES (?,?,?,'pending',0,?,?,?,?) RETURNING *`,
    args: [input.queue, input.id, input.payload, input.maxAttempts, input.availableAt, input.now, input.now],
  })).rows[0]
  if (!row) throw new Error('Queue insert returned no row')
  return job(row)
}

/** Borrows the connection. Callers own migrations and database shutdown. */
export class SqliteQueueStore implements QueueStore {
  constructor(private readonly database: Database) {}
  async enqueueInTransaction(transaction: SqlExecutor, input: NewJob): Promise<StoredJob> {
    assertTransactionExecutor(transaction, this.database)
    return insertSqliteJob(transaction, input)
  }
  async enqueue(input: NewJob): Promise<StoredJob> {
    return insertSqliteJob(this.database, input)
  }
  async get(queue: string, id: string) {
    const row = (await this.database.execute({ sql: 'SELECT * FROM longhorn_queue_jobs WHERE queue = ? AND id = ?', args: [queue, id] })).rows[0]
    return row ? job(row) : undefined
  }
  async claim(input: Claim): Promise<StoredJob | undefined> {
    // SQLite write transactions serialize candidate selection and lease assignment across processes.
    return this.database.transaction(async (tx) => {
      await tx.execute({
        sql: `UPDATE longhorn_queue_jobs SET state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
          lease_token = NULL, lease_until = NULL, last_failure = 'lease-expired', available_at = ?, updated_at = ?
          WHERE queue = ? AND state = 'running' AND lease_until <= ?`,
        args: [input.now, input.now, input.queue, input.now],
      })
      const candidate = (await tx.execute({
        sql: `SELECT id FROM longhorn_queue_jobs WHERE queue = ? AND state = 'pending' AND available_at <= ?
          ORDER BY available_at, created_at, id LIMIT 1`, args: [input.queue, input.now],
      })).rows[0]
      if (!candidate) return undefined
      const row = (await tx.execute({
        sql: `UPDATE longhorn_queue_jobs SET state = 'running', attempts = attempts + 1,
          updated_at = ?, lease_token = ?, lease_until = ? WHERE queue = ? AND id = ? RETURNING *`,
        args: [input.now, input.token, input.now + input.leaseMs, input.queue, text(candidate.id)],
      })).rows[0]
      if (!row) throw new Error('Queue claim returned no row')
      return job(row)
    })
  }
  async complete(input: Ownership) {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue_jobs SET state = 'succeeded', updated_at = ?,
      lease_token = NULL, lease_until = NULL WHERE ${owned}`, args: [input.now, ...ownershipArgs(input)] })).rowsAffected === 1
  }
  async fail(input: FailJob) {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue_jobs SET
      state = CASE WHEN ? IS NULL OR attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
      available_at = COALESCE(?, available_at), updated_at = ?, lease_token = NULL, lease_until = NULL, last_failure = ?
      WHERE ${owned}`, args: [input.retryAt, input.retryAt, input.now, input.reason, ...ownershipArgs(input)] })).rowsAffected === 1
  }
  async renew(input: Ownership & { leaseMs: number }) {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue_jobs SET lease_until = MAX(lease_until, ?),
      updated_at = ? WHERE ${owned}`, args: [input.now + input.leaseMs, input.now, ...ownershipArgs(input)] })).rowsAffected === 1
  }
}
