import { expect, it } from 'vitest'
import { redisConfigSchema } from './redis-config.js'
it('keeps Redis task configuration explicit and validates transport before resource acquisition', () => {
  expect(redisConfigSchema.parse({ REDIS_URL: 'rediss://cache.example/0' })).toMatchObject({ port: 3013, cacheTtlMs: 5000, databasePath: './data/redis-tasks.sqlite', redis: { namespace: 'tasks', allowInsecureLoopback: false } })
  expect(redisConfigSchema.parse({ REDIS_URL: 'redis://127.0.0.1:6379/0', REDIS_ALLOW_INSECURE_LOOPBACK: 'true' }).redis.allowInsecureLoopback).toBe(true)
  for (const extra of [{ REDIS_NAMESPACE: '*' }, { REDIS_COMMAND_TIMEOUT_MS: '0' }, { REDIS_URL: 'redis://remote.example:6379/0' }, { REDIS_URL: 'redis://127.0.0.1:6379/0' }, { REDIS_URL: 'redis://127.0.0.1:6379/0', REDIS_ALLOW_INSECURE_LOOPBACK: 'true', REDIS_TLS_CA: 'not for plaintext' }]) expect(redisConfigSchema.safeParse({ REDIS_URL: 'rediss://cache.example/0', ...extra }).success).toBe(false)
})
