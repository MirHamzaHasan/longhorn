import { token } from '@longhorn/container'
import { z } from 'zod'

export const configSchema = z.object({
  APP_NAME: z.string().trim().min(1).default('LongHorn'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_PATH: z.string().trim().min(1).default('./data/longhorn.sqlite'),
  CACHE_TTL_MS: z.string().trim().regex(/^\d+$/).default('5000').transform(Number).pipe(z.number().int().min(0).max(3600000)),
  PORT: z.string().trim().regex(/^\d+$/, 'Expected a decimal port number')
    .default('3000').transform(Number).pipe(z.number().int().min(0).max(65535)),
}).transform(({ APP_NAME, HOST, PORT, LOG_LEVEL, DATABASE_PATH, CACHE_TTL_MS }) => ({
  appName: APP_NAME,
  hostname: HOST,
  port: PORT,
  logLevel: LOG_LEVEL,
  databasePath: DATABASE_PATH,
  cacheTtlMs: CACHE_TTL_MS,
}))

export type AppConfig = Readonly<z.output<typeof configSchema>>
export const AppSettings = token<AppConfig>('application settings')
export const defaultConfig: AppConfig = Object.freeze(configSchema.parse({}))
