import { z } from 'zod'

export type ReportLimitBindings = { REPORT_LIMIT_ENABLED?: string; REPORT_LIMIT_REQUESTS?: string; REPORT_LIMIT_WINDOW_MS?: string }
export const reportConfigSchema = z.object({
  REPORT_LIMIT_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  REPORT_LIMIT_REQUESTS: z.string().regex(/^\d+$/).default('60').transform(Number).pipe(z.number().int().min(1).max(1000000)),
  REPORT_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).default('60000').transform(Number).pipe(z.number().int().min(1000).max(86400000)),
}).transform(value => ({
  ...(value.REPORT_LIMIT_ENABLED ? { requestLimits: { limit: value.REPORT_LIMIT_REQUESTS, windowMs: value.REPORT_LIMIT_WINDOW_MS } } : {}),
}))
export type ReportConfig = Readonly<z.output<typeof reportConfigSchema>>

/** Synchronous Object construction must validate before acquiring its app/storage resources. */
export function parseReportConfig(input: ReportLimitBindings): ReportConfig | undefined {
  const result = reportConfigSchema.safeParse(input)
  return result.success ? result.data : undefined
}
