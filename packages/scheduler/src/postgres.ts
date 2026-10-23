import type { Database, Migration, SqlRow } from '@longhorn/database'
import { insertPostgresJob } from '@longhorn/queue/postgres'
import { occurrence } from './occurrence.js'
import type { NewSchedule, ScheduleState, ScheduleTiming, SchedulerStore, StoredSchedule, TickResult } from './types.js'

/** Append after the deployed prefix; PostgreSQL queue migrations must precede dispatch. */
export const postgresSchedulerMigrations: readonly Migration[] = [{ id: 'longhorn_postgres_scheduler/001_schedules', statements: [
  'CREATE SCHEMA IF NOT EXISTS longhorn_scheduler',
  `CREATE TABLE longhorn_scheduler.schedules (
    id text PRIMARY KEY,queue text NOT NULL,payload text NOT NULL,
    max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
    timing text NOT NULL,missed text NOT NULL CHECK (missed IN ('latest','catch-up')),
    state text NOT NULL CHECK (state IN ('active','completed','cancelled')),
    first_at bigint NOT NULL CHECK (first_at BETWEEN 0 AND 8640000000000000),
    next_at bigint CHECK (next_at BETWEEN 0 AND 8640000000000000),
    created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
    updated_at bigint NOT NULL CHECK (updated_at BETWEEN 0 AND 8640000000000000),
    dispatch_count bigint NOT NULL CHECK (dispatch_count BETWEEN 0 AND 9007199254740991),
    last_scheduled_at bigint CHECK (last_scheduled_at BETWEEN 0 AND 8640000000000000),last_job_id text,
    CHECK ((state='active' AND next_at IS NOT NULL) OR (state<>'active' AND next_at IS NULL))
  )`,
  "CREATE INDEX schedules_due ON longhorn_scheduler.schedules(next_at,created_at,id) WHERE state='active'",
] }]
function integer(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new Error('Invalid PostgreSQL schedule integer')
  return result
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid PostgreSQL schedule text'); return value }
function schedule(row: SqlRow): StoredSchedule {
  return { id: text(row.id),queue: text(row.queue),payload: text(row.payload),maxAttempts: integer(row.max_attempts),
    timing: JSON.parse(text(row.timing)) as ScheduleTiming,missed: text(row.missed) as 'latest' | 'catch-up',
    state: text(row.state) as ScheduleState,firstAt: integer(row.first_at),nextAt: row.next_at === null ? null : integer(row.next_at),
    createdAt: integer(row.created_at),updatedAt: integer(row.updated_at),dispatchCount: integer(row.dispatch_count),
    lastScheduledAt: row.last_scheduled_at === null ? null : integer(row.last_scheduled_at),
    lastJobId: row.last_job_id === null ? null : text(row.last_job_id) }
}
const due = `SELECT * FROM longhorn_scheduler.schedules WHERE state='active' AND next_at<=$1::bigint
  ORDER BY next_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`

/** Borrows the same PostgreSQL database that contains longhorn_queue.jobs. */
export class PostgresSchedulerStore implements SchedulerStore {
  constructor(private readonly database: Database) {
    if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL scheduler requires a PostgreSQL database')
  }
  async create(input: NewSchedule): Promise<StoredSchedule> {
    return this.database.transaction(async (tx) => {
      await tx.execute({ sql: `INSERT INTO longhorn_scheduler.schedules
        (id,queue,payload,max_attempts,timing,missed,state,first_at,next_at,created_at,updated_at,dispatch_count)
        VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7,$8,$8,0) ON CONFLICT(id) DO NOTHING`,
      args: [input.id,input.queue,input.payload,input.maxAttempts,JSON.stringify(input.timing),input.missed,input.firstAt,input.now] })
      // A separate READ COMMITTED statement observes the winner after a concurrent INSERT conflict.
      const row = (await tx.execute({ sql: 'SELECT * FROM longhorn_scheduler.schedules WHERE id=$1', args: [input.id] })).rows[0]
      if (!row) throw new Error('PostgreSQL schedule registration returned no row')
      return schedule(row)
    })
  }
  async get(id: string): Promise<StoredSchedule | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT * FROM longhorn_scheduler.schedules WHERE id=$1', args: [id] })).rows[0]
    return row ? schedule(row) : undefined
  }
  async cancel(id: string, now: number): Promise<boolean> {
    return (await this.database.execute({ sql: "UPDATE longhorn_scheduler.schedules SET state='cancelled',next_at=NULL,updated_at=$2 WHERE id=$1 AND state='active'", args: [id,now] })).rowsAffected === 1
  }
  async dispatch(input: { now: number; limit: number }): Promise<TickResult> {
    return this.database.transaction(async (tx) => {
      const dispatched = []
      while (dispatched.length < input.limit) {
        const found = (await tx.execute({ sql: due,args: [input.now] })).rows[0]
        if (!found) break
        const row = schedule(found), { dispatch,next } = occurrence(row,input.now)
        await insertPostgresJob(tx,{ id: dispatch.jobId,queue: row.queue,payload: row.payload,maxAttempts: row.maxAttempts,now: input.now,availableAt: input.now })
        await tx.execute({ sql: `UPDATE longhorn_scheduler.schedules SET state=$2,next_at=$3,updated_at=$4,
          dispatch_count=$5,last_scheduled_at=$6,last_job_id=$7 WHERE id=$1`,
        args: [row.id,next.state,next.nextAt,next.updatedAt,next.dispatchCount,next.lastScheduledAt,next.lastJobId] })
        dispatched.push(dispatch)
      }
      // Locked work belongs to another dispatcher; the host will poll again normally.
      const more = (await tx.execute({ sql: due,args: [input.now] })).rows.length > 0
      return { dispatched,more }
    })
  }
}
