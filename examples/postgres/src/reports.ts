import type { Database, Migration } from '@longhornjs/database'
import type { JobHandler } from '@longhornjs/queue'
import { z } from 'zod'

export const taskReportQueueName = 'postgres.task-reports.v1'
export const taskReportSchema = z.object({ scope: z.enum(['all','open','completed']).default('all') }).strict()
export type TaskReportInput = z.output<typeof taskReportSchema>
export const taskReportScheduleSchema = taskReportSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('once'),at: z.number().int().min(0).max(8_640_000_000_000_000) }).strict(),
    z.object({ kind: z.literal('interval'),intervalMs: z.number().int().min(50).max(86_400_000),
      startAt: z.number().int().min(0).max(8_640_000_000_000_000).optional(),missed: z.enum(['latest','catch-up']).optional() }).strict(),
    z.object({ kind: z.literal('cron'),expression: z.string().min(1).max(200),
      startAt: z.number().int().min(0).max(8_640_000_000_000_000).optional(),missed: z.enum(['latest','catch-up']).optional() }).strict(),
  ]),
}).strict()
export const reportParams = z.object({ id: z.string().min(1).max(200) })
export const taskReportMigrations: readonly Migration[] = [{ id: 'postgres_tasks/002_reports',statements: [
  `CREATE TABLE longhorn_pg_example.task_reports (
    job_id text PRIMARY KEY,total bigint NOT NULL CHECK (total>=0),
    completed bigint NOT NULL CHECK (completed>=0 AND completed<=total),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
  )`,
] }]
export function taskReportHandler(database: Database): JobHandler<TaskReportInput> {
  return async ({ scope },context) => {
    if (context.signal.aborted) return
    // The result and task counts share one statement snapshot; job ID fences repeated effects.
    await database.execute({ sql: `INSERT INTO longhorn_pg_example.task_reports(job_id,total,completed)
      SELECT $1,count(*),count(*) FILTER (WHERE completed) FROM longhorn_pg_example.tasks
      WHERE ($2::boolean IS NULL OR completed=$2::boolean) ON CONFLICT(job_id) DO NOTHING`,
    args: [context.id,scope==='all' ? null : scope==='completed'] })
  }
}
export async function taskReport(database: Database,id: string) {
  const row = (await database.execute({ sql: 'SELECT total,completed,created_at FROM longhorn_pg_example.task_reports WHERE job_id=$1',args: [id] })).rows[0]
  if (!row) return null
  if (typeof row.total!=='bigint' || typeof row.completed!=='bigint' || typeof row.created_at!=='string') throw new Error('Invalid PostgreSQL report row')
  return { total: row.total.toString(),completed: row.completed.toString(),open: (row.total-row.completed).toString(),createdAt: row.created_at }
}
