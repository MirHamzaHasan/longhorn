import { z } from 'zod'
import { redisConnectionUrl } from '@longhorn/node/redis'
import { appConfig, configInputSchema } from './config.js'
export const redisConfigSchema = configInputSchema.extend({
  PORT: z.string().trim().regex(/^\d+$/).default('3013').transform(Number).pipe(z.number().int().min(0).max(65535)),
  DATABASE_PATH: z.string().trim().min(1).default('./data/redis-tasks.sqlite'),
  REDIS_URL: z.string().min(1),
  REDIS_NAMESPACE: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('tasks'),
  REDIS_TLS_CA: z.string().min(1).max(262144).optional(),
  REDIS_ALLOW_INSECURE_LOOPBACK: z.enum(['true','false']).default('false').transform(value => value === 'true'),
  REDIS_CONNECT_TIMEOUT_MS: z.string().regex(/^\d+$/).default('5000').transform(Number).pipe(z.number().int().min(1).max(60000)),
  REDIS_COMMAND_TIMEOUT_MS: z.string().regex(/^\d+$/).default('2000').transform(Number).pipe(z.number().int().min(1).max(60000)),
}).superRefine((value, context) => {
  try { const url = redisConnectionUrl(value.REDIS_URL, value.REDIS_ALLOW_INSECURE_LOOPBACK); if (value.REDIS_TLS_CA !== undefined && !url.startsWith('rediss:')) throw new Error() }
  catch { context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Invalid Redis endpoint or transport policy' }) }
}).transform(value => ({ ...appConfig(value), redis: {
  url: value.REDIS_URL, namespace: value.REDIS_NAMESPACE, allowInsecureLoopback: value.REDIS_ALLOW_INSECURE_LOOPBACK,
  connectTimeoutMs: value.REDIS_CONNECT_TIMEOUT_MS, commandTimeoutMs: value.REDIS_COMMAND_TIMEOUT_MS,
  ...(value.REDIS_TLS_CA === undefined ? {} : { tlsCa: value.REDIS_TLS_CA }),
} }))
export type RedisTaskConfig = Readonly<z.output<typeof redisConfigSchema>>
