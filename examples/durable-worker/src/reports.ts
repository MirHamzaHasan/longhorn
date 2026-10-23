import type { Database, Migration } from '@longhorn/database'
import type { JobHandler } from '@longhorn/queue'
import { queueMigrations } from '@longhorn/queue/sqlite'
import { schedulerMigrations } from '@longhorn/scheduler/sqlite'
import { z } from 'zod'

export const reportSchema = z.object({ numbers: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100) }).strict()
export type ReportInput = z.output<typeof reportSchema>
export const reportQueueName = 'durable.reports.v1'
// One authoritative prefix for every table in this Object's private database.
export const migrations: readonly Migration[] = [...queueMigrations, ...schedulerMigrations, {
  id: 'durable_worker/001_reports', statements: [
    'CREATE TABLE worker_reports (job_id TEXT PRIMARY KEY, result TEXT NOT NULL) STRICT',
  ],
}]
export function reportHandler(database: Database): JobHandler<ReportInput> {
  return async ({ numbers }, job) => {
    job.signal.throwIfAborted()
    const result = { count: numbers.length, sum: numbers.reduce((total, n) => total+n, 0), min: Math.min(...numbers), max: Math.max(...numbers) }
    await database.execute({ sql: 'INSERT INTO worker_reports (job_id,result) VALUES (?,?) ON CONFLICT(job_id) DO NOTHING', args: [job.id, JSON.stringify(result)] })
  }
}
