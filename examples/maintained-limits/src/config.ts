import { z } from 'zod'
const integer = (fallback: string, min: number, max: number) => z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(min).max(max))
export const maintainedLimitsConfig = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'), PORT: integer('3029', 0, 65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  API_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  RATE_LIMIT_SUBJECT: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).default('service-client'),
  RATE_LIMIT_REQUESTS: integer('60', 1, 1000000), RATE_LIMIT_WINDOW_MS: integer('60000', 1000, 86400000),
  DATABASE_PATH: z.string().trim().min(1).default('examples/maintained-limits/data/reports.sqlite'),
  LIMIT_CLEANUP_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  LIMIT_CLEANUP_LIMIT: integer('100', 1, 10000), LIMIT_CLEANUP_INTERVAL_MS: integer('60000', 1000, 86400000),
}).transform(value => ({ hostname: value.HOST, port: value.PORT, logLevel: value.LOG_LEVEL, apiToken: value.API_TOKEN,
  subject: value.RATE_LIMIT_SUBJECT, limit: value.RATE_LIMIT_REQUESTS, windowMs: value.RATE_LIMIT_WINDOW_MS, databasePath: value.DATABASE_PATH,
  ...(value.LIMIT_CLEANUP_ENABLED ? { cleanup: { limit: value.LIMIT_CLEANUP_LIMIT, intervalMs: value.LIMIT_CLEANUP_INTERVAL_MS } } : {}),
}))
