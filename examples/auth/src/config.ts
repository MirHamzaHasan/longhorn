import { z } from 'zod'

export const configSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().regex(/^\d+$/).default('3001').transform(Number).pipe(z.number().int().min(0).max(65535)),
  AUTH_ORIGIN: z.string().default('http://127.0.0.1:3001'),
  // This local example explicitly opts into loopback development cookies.
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SESSION_TTL_SECONDS: z.string().regex(/^\d+$/).default('28800').transform(Number).pipe(z.number().int().min(1).max(2592000)),
  DATABASE_PATH: z.string().trim().min(1).default('./data/auth.sqlite'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).transform((input) => ({
  hostname: input.HOST, port: input.PORT, origin: input.AUTH_ORIGIN, secure: input.AUTH_COOKIE_SECURE,
  sessionTtlMs: input.SESSION_TTL_SECONDS * 1000, databasePath: input.DATABASE_PATH, logLevel: input.LOG_LEVEL,
}))
export type AppConfig = z.output<typeof configSchema>
