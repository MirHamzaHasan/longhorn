import { z } from 'zod'
import { reportSchema } from './reports.js'

const recurring = {
  startAt: z.number().int().min(0).max(8_640_000_000_000_000).optional(),
  missed: z.enum(['latest', 'catch-up']).optional(),
}
export const reportScheduleSchema = reportSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('once'), at: z.number().int().min(0).max(8_640_000_000_000_000) }).strict(),
    z.object({ kind: z.literal('interval'), intervalMs: z.number().int().min(50).max(86_400_000), ...recurring }).strict(),
    z.object({ kind: z.literal('cron'), expression: z.string().min(1).max(200), ...recurring }).strict(),
  ]),
}).strict()
