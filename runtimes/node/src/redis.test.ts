import { expect, it } from 'vitest'
import { openRedis, redisConnectionUrl } from './redis.js'
it('requires explicit secure endpoints or opted-in loopback, with credentials never echoed in errors', () => {
  expect(redisConnectionUrl('rediss://default:private-secret@redis.example:6380/2')).toContain('redis.example')
  expect(redisConnectionUrl('redis://127.0.0.1:6379/0', true)).toBe('redis://127.0.0.1:6379/0')
  for (const url of ['redis://redis.example:6379', 'redis://127.0.0.1:6379', 'https://private-secret@redis.example', 'rediss://redis.example/0?x=private-secret', 'rediss://redis.example/0#private-secret', 'rediss://redis.example/../2', 'rediss://redis.example/-1']) {
    try { redisConnectionUrl(url); throw new Error('Should reject') } catch (error) { expect(String(error)).not.toContain('private-secret'); expect(String(error)).toContain('Invalid Redis') }
  }
})
it('rejects invalid resource budgets and non-TLS CA configuration before connecting', async () => {
  for (const options of [{ maxConcurrent: 0 }, { commandTimeoutMs: 0 }, { connectTimeoutMs: 60001 }, { maxCommandBytes: Infinity }, { tlsCa: 'private certificate' }]) await expect(openRedis({ url: 'redis://127.0.0.1:1', allowInsecureLoopback: true, ...options })).rejects.toThrow('Invalid Redis')
})
