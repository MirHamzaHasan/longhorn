import type { Database, Migration } from '@longhorn/database'
import type { JobHandler } from '@longhorn/queue'
import { z } from 'zod'

// A new incompatible payload belongs on a new queue name, e.g. reports.v2.
export const reportQueueName = 'reports.v1'
export const reportSchema = z.object({ numbers: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(1000) }).strict()
export type ReportInput = z.output<typeof reportSchema>
export type ReportResult = { readonly count: number; readonly sum: number; readonly min: number; readonly max: number }
export type ReportComputer = (input: ReportInput, signal: AbortSignal) => ReportResult | Promise<ReportResult>
export type ReportComputerResource = { readonly compute: ReportComputer; healthy(signal?: AbortSignal): Promise<boolean>; close(): Promise<void> }
export const localReportComputer: ReportComputer = ({ numbers }) => Object.freeze({ count: numbers.length,
  sum: numbers.reduce((sum, value) => sum + value, 0), min: Math.min(...numbers), max: Math.max(...numbers) })
export const reportMigrations: readonly Migration[] = [{ id: 'jobs_example/001_reports', statements: [
  `CREATE TABLE example_reports (
    job_id TEXT PRIMARY KEY, result TEXT NOT NULL
  ) STRICT`,
] }]

export function reportHandler(database: Database, compute: ReportComputer = localReportComputer): JobHandler<ReportInput> {
  return async ({ numbers }, context) => {
    if (context.signal.aborted) return
    const result = await compute({ numbers }, context.signal)
    if (context.signal.aborted) return
    // Stable job ID makes this effect idempotent if a crash happens before queue acknowledgement.
    await database.execute({ sql: 'INSERT INTO example_reports (job_id, result) VALUES (?, ?) ON CONFLICT(job_id) DO NOTHING',
      args: [context.id, JSON.stringify(result)] })
  }
}
