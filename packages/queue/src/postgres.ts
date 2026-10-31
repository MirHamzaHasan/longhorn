import type { Database, Migration, SqlExecutor, SqlRow } from '@longhornjs/database'
import { assertTransactionExecutor } from '@longhornjs/database/transactions'
import type { Claim, FailJob, JobFailure, JobState, NewJob, Ownership, QueueStore, StoredJob } from './types.js'

/** Append to one complete PostgreSQL migration history; the runtime role needs only DML. */
export const postgresQueueMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_queue/001_jobs', statements: [
  'CREATE SCHEMA IF NOT EXISTS longhorn_queue',
  `CREATE TABLE longhorn_queue.jobs (
    queue text NOT NULL, id text NOT NULL, payload text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending','running','succeeded','failed')),
    attempts integer NOT NULL CHECK (attempts >= 0),
    max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100 AND attempts <= max_attempts),
    available_at bigint NOT NULL CHECK (available_at BETWEEN 0 AND 9007199254740991),
    created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
    updated_at bigint NOT NULL CHECK (updated_at BETWEEN 0 AND 9007199254740991),
    lease_token text, lease_until bigint CHECK (lease_until BETWEEN 0 AND 9007199254740991),
    last_failure text CHECK (last_failure IN ('handler','invalid-payload','lease-expired')),
    PRIMARY KEY (queue,id),
    CHECK ((state = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (state <> 'running' AND lease_token IS NULL AND lease_until IS NULL))
  )`,
  "CREATE INDEX jobs_ready ON longhorn_queue.jobs(queue,available_at,created_at,id) WHERE state = 'pending'",
  "CREATE INDEX jobs_expired ON longhorn_queue.jobs(queue,lease_until,id) WHERE state = 'running'",
] }]

function integer(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new Error('Invalid PostgreSQL queue integer')
  return result
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid PostgreSQL queue text'); return value }
function job(row: SqlRow): StoredJob {
  return { id: text(row.id), queue: text(row.queue), payload: text(row.payload), state: text(row.state) as JobState,
    attempts: integer(row.attempts), maxAttempts: integer(row.max_attempts),
    availableAt: integer(row.available_at), createdAt: integer(row.created_at), updatedAt: integer(row.updated_at),
    leaseToken: row.lease_token === null ? null : text(row.lease_token),
    leaseUntil: row.lease_until === null ? null : integer(row.lease_until),
    lastFailure: row.last_failure === null ? null : text(row.last_failure) as JobFailure }
}
const owned = "queue=$1 AND id=$2 AND state='running' AND lease_token=$3 AND lease_until>$4::bigint"
const ownershipArgs = (input: Ownership) => [input.queue, input.id, input.token, input.now] as const

/** Caller owns input validation, transaction commit, migrations and connection lifetime. */
export async function insertPostgresJob(executor: SqlExecutor, input: NewJob): Promise<StoredJob> {
  if (executor.dialect !== undefined && executor.dialect !== 'postgres') throw new Error('PostgreSQL queue requires a PostgreSQL executor')
  const row = (await executor.execute({ sql: `INSERT INTO longhorn_queue.jobs
    (queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at)
    VALUES ($1,$2,$3,'pending',0,$4,$5,$6,$6) RETURNING *`,
  args: [input.queue, input.id, input.payload, input.maxAttempts, input.availableAt, input.now] })).rows[0]
  if (!row) throw new Error('PostgreSQL queue insert returned no row')
  return job(row)
}

/** Borrows a PostgreSQL database. Each claim holds locks only until lease assignment commits. */
export class PostgresQueueStore implements QueueStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL queue requires a PostgreSQL database')
  }
  enqueue(input: NewJob): Promise<StoredJob> { return insertPostgresJob(this.database, input) }
  async enqueueInTransaction(transaction: SqlExecutor, input: NewJob): Promise<StoredJob> {
    assertTransactionExecutor(transaction, this.database)
    return insertPostgresJob(transaction, input)
  }
  async get(queue: string, id: string): Promise<StoredJob | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT * FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2', args: [queue, id] })).rows[0]
    return row ? job(row) : undefined
  }
  async claim(input: Claim): Promise<StoredJob | undefined> {
    return this.database.transaction(async (tx) => {
      // Bounded recovery avoids locking an entire backlog. Other consumers skip these rows.
      await tx.execute({ sql: `WITH expired AS (
        SELECT queue,id FROM longhorn_queue.jobs WHERE queue=$1 AND state='running' AND lease_until<=$2::bigint
        ORDER BY lease_until,id LIMIT 100 FOR UPDATE SKIP LOCKED
      ) UPDATE longhorn_queue.jobs AS jobs SET
        state=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
        lease_token=NULL,lease_until=NULL,last_failure='lease-expired',available_at=$2,updated_at=$2
        FROM expired WHERE jobs.queue=expired.queue AND jobs.id=expired.id`, args: [input.queue, input.now] })
      const row = (await tx.execute({ sql: `WITH candidate AS (
        SELECT queue,id FROM longhorn_queue.jobs WHERE queue=$1 AND state='pending' AND available_at<=$2::bigint
        ORDER BY available_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
      ) UPDATE longhorn_queue.jobs AS jobs SET state='running',attempts=attempts+1,
        updated_at=$2,lease_token=$3,lease_until=$4 FROM candidate
        WHERE jobs.queue=candidate.queue AND jobs.id=candidate.id RETURNING jobs.*`,
      args: [input.queue, input.now, input.token, input.now + input.leaseMs] })).rows[0]
      return row ? job(row) : undefined
    })
  }
  async complete(input: Ownership): Promise<boolean> {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue.jobs SET state='succeeded',updated_at=$4,
      lease_token=NULL,lease_until=NULL WHERE ${owned}`, args: ownershipArgs(input) })).rowsAffected === 1
  }
  async fail(input: FailJob): Promise<boolean> {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue.jobs SET
      state=CASE WHEN $5::bigint IS NULL OR attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
      available_at=COALESCE($5::bigint,available_at),updated_at=$4,lease_token=NULL,lease_until=NULL,last_failure=$6
      WHERE ${owned}`, args: [...ownershipArgs(input), input.retryAt, input.reason] })).rowsAffected === 1
  }
  async renew(input: Ownership & { leaseMs: number }): Promise<boolean> {
    return (await this.database.execute({ sql: `UPDATE longhorn_queue.jobs SET lease_until=GREATEST(lease_until,$5::bigint),
      updated_at=$4 WHERE ${owned}`, args: [...ownershipArgs(input), input.now + input.leaseMs] })).rowsAffected === 1
  }
}
