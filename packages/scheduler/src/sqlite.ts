import type { Database, Migration, SqlRow } from '@longhorn/database'
import { insertSqliteJob } from '@longhorn/queue/sqlite'
import { occurrence } from './occurrence.js'
import type { NewSchedule, ScheduleState, ScheduleTiming, SchedulerStore, StoredSchedule, TickResult } from './types.js'

/** Append after the deployed migration prefix. Queue tables must exist before dispatch. */
export const schedulerMigrations: readonly Migration[] = [{ id: 'longhorn_scheduler/001_schedules', statements: [
  `CREATE TABLE longhorn_schedules (
    id TEXT PRIMARY KEY, queue TEXT NOT NULL, payload TEXT NOT NULL, max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
    timing TEXT NOT NULL, missed TEXT NOT NULL CHECK (missed IN ('latest','catch-up')),
    state TEXT NOT NULL CHECK (state IN ('active','completed','cancelled')),
    first_at INTEGER NOT NULL, next_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    dispatch_count INTEGER NOT NULL CHECK (dispatch_count >= 0), last_scheduled_at INTEGER, last_job_id TEXT,
    CHECK ((state = 'active' AND next_at IS NOT NULL) OR (state <> 'active' AND next_at IS NULL))
  ) STRICT`,
  "CREATE INDEX longhorn_schedules_due ON longhorn_schedules(next_at, created_at, id) WHERE state = 'active'",
] }]
function integer(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new Error('Invalid schedule integer')
  return result
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid schedule text'); return value }
function schedule(row: SqlRow): StoredSchedule {
  return { id: text(row.id), queue: text(row.queue), payload: text(row.payload), maxAttempts: integer(row.max_attempts),
    timing: JSON.parse(text(row.timing)) as ScheduleTiming, missed: text(row.missed) as 'latest' | 'catch-up',
    state: text(row.state) as ScheduleState, firstAt: integer(row.first_at), nextAt: row.next_at === null ? null : integer(row.next_at),
    createdAt: integer(row.created_at), updatedAt: integer(row.updated_at), dispatchCount: integer(row.dispatch_count),
    lastScheduledAt: row.last_scheduled_at === null ? null : integer(row.last_scheduled_at),
    lastJobId: row.last_job_id === null ? null : text(row.last_job_id) }
}
const due = "SELECT * FROM longhorn_schedules WHERE state = 'active' AND next_at <= ? ORDER BY next_at, created_at, id LIMIT 1"

/** Borrows the same SQLite connection/database that owns the destination queue rows. */
export class SqliteSchedulerStore implements SchedulerStore {
  constructor(private readonly database: Database) {}
  async create(input: NewSchedule): Promise<StoredSchedule> {
    return this.database.transaction(async (tx) => {
      await tx.execute({ sql: `INSERT INTO longhorn_schedules
        (id,queue,payload,max_attempts,timing,missed,state,first_at,next_at,created_at,updated_at,dispatch_count)
        VALUES (?,?,?,?,?,?,'active',?,?,?,?,0) ON CONFLICT(id) DO NOTHING`,
      args: [input.id, input.queue, input.payload, input.maxAttempts, JSON.stringify(input.timing), input.missed,
        input.firstAt, input.firstAt, input.now, input.now] })
      const row = (await tx.execute({ sql: 'SELECT * FROM longhorn_schedules WHERE id = ?', args: [input.id] })).rows[0]
      if (!row) throw new Error('Schedule registration returned no row')
      return schedule(row)
    })
  }
  async get(id: string): Promise<StoredSchedule | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT * FROM longhorn_schedules WHERE id = ?', args: [id] })).rows[0]
    return row ? schedule(row) : undefined
  }
  async cancel(id: string, now: number): Promise<boolean> {
    return (await this.database.execute({ sql: "UPDATE longhorn_schedules SET state = 'cancelled', next_at = NULL, updated_at = ? WHERE id = ? AND state = 'active'", args: [now, id] })).rowsAffected === 1
  }
  async dispatch(input: { now: number; limit: number }): Promise<TickResult> {
    return this.database.transaction(async (tx) => {
      const dispatched = []
      while (dispatched.length < input.limit) {
        const found = (await tx.execute({ sql: due, args: [input.now] })).rows[0]
        if (!found) break
        const row = schedule(found)
        const { dispatch, next } = occurrence(row, input.now)
        await insertSqliteJob(tx, { id: dispatch.jobId, queue: row.queue, payload: row.payload,
          maxAttempts: row.maxAttempts, now: input.now, availableAt: input.now })
        await tx.execute({ sql: `UPDATE longhorn_schedules SET state = ?, next_at = ?, updated_at = ?,
          dispatch_count = ?, last_scheduled_at = ?, last_job_id = ? WHERE id = ?`,
        args: [next.state, next.nextAt, next.updatedAt, next.dispatchCount, next.lastScheduledAt, next.lastJobId, row.id] })
        dispatched.push(dispatch)
      }
      const more = (await tx.execute({ sql: due, args: [input.now] })).rows.length > 0
      return { dispatched, more }
    })
  }
}
