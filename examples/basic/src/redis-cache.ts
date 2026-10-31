import { RedisCacheStore } from '@longhornjs/cache/redis'
import { jsonCacheCodec } from '@longhornjs/cache/json'
import { openRedis } from '@longhornjs/node/redis'
import { z } from 'zod'
import type { RedisTaskConfig } from './redis-config.js'
import type { TaskSummary } from './tasks.js'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const summarySchema = z.object({ total: count, completed: count, pending: count, generatedAt: z.iso.datetime() }).strict()
  .refine(value => value.completed + value.pending === value.total)
export async function openTaskRedisCache(config: RedisTaskConfig): Promise<RedisCacheStore<TaskSummary>> {
  const client = await openRedis(config.redis)
  try { return new RedisCacheStore(client, { namespace: config.redis.namespace, codec: jsonCacheCodec(value => summarySchema.parse(value)) }) }
  catch (error) { await client.close(); throw error }
}
