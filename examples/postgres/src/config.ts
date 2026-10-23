import { z } from 'zod'
export const postgresUrl = z.string().min(1).refine((value) => {
  try { const url = new URL(value); return ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.hostname && !!url.username && url.pathname.length > 1 && !url.search && !url.hash } catch { return false }
}, 'Expected a PostgreSQL TCP URL with user/database and no query/hash options')
export const configInputSchema = z.object({
  DATABASE_URL: postgresUrl,
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().trim().regex(/^\d+$/).default('3003').transform(Number).pipe(z.number().int().min(0).max(65535)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  PG_MAX_CONNECTIONS: z.string().trim().regex(/^\d+$/).default('5').transform(Number).pipe(z.number().int().min(1).max(100)),
  WORKER_ENABLED: z.enum(['true','false']).default('true').transform(value => value==='true'),
  SCHEDULER_ENABLED: z.enum(['true','false']).default('true').transform(value => value==='true'),
  AUTH_ORIGIN: z.string().default('http://127.0.0.1:3003'),
  AUTH_COOKIE_SECURE: z.enum(['true','false']).default('false').transform(value => value==='true'),
  SESSION_TTL_SECONDS: z.string().regex(/^\d+$/).default('28800').transform(Number).pipe(z.number().int().min(1).max(2592000)),
})
export const configSchema = configInputSchema.transform(({ DATABASE_URL, HOST, PORT, LOG_LEVEL, PG_MAX_CONNECTIONS, WORKER_ENABLED, SCHEDULER_ENABLED,AUTH_ORIGIN,AUTH_COOKIE_SECURE,SESSION_TTL_SECONDS }) => ({
  databaseUrl: DATABASE_URL, hostname: HOST, port: PORT, logLevel: LOG_LEVEL, maxConnections: PG_MAX_CONNECTIONS,
  workerEnabled: WORKER_ENABLED,schedulerEnabled: SCHEDULER_ENABLED,
  authOrigin: AUTH_ORIGIN,secureCookies: AUTH_COOKIE_SECURE,sessionTtlMs: SESSION_TTL_SECONDS*1000,
}))
export const migrationConfigSchema = z.object({ MIGRATION_DATABASE_URL: postgresUrl })
export type AppConfig = Readonly<z.output<typeof configSchema>>
