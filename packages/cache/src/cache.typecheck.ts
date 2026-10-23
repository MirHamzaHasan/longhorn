import { Cache } from './index.js'
import { MemoryCacheStore } from './memory.js'
import { jsonCacheCodec } from './codec.js'
import { RedisCacheStore, type RedisCommandClient } from './redis.js'

function verifyCacheTypes(): void {
  const cache = new Cache<{ readonly id: string }>(new MemoryCacheStore())
  void cache.set('one', { id: 'ok' })
  // @ts-expect-error One cache has one value schema; a set cannot widen it.
  void cache.set('two', { id: 12 })
  // @ts-expect-error Loaders must return the cache's value type.
  void cache.getOrLoad('three', async () => 'bad')
  // @ts-expect-error Reads cannot reinterpret the value with an arbitrary generic.
  void cache.get<string>('one')
  void cache.get('one').then((entry) => {
    if (entry.hit) { const id: string = entry.value.id }
    else {
      // @ts-expect-error A miss has no value, distinct from a hit storing undefined.
      const missing = entry.value
    }
  })
}

function verifyRedisTypes(client: RedisCommandClient): void {
  type Profile = { readonly id: string }
  const codec = jsonCacheCodec(async (value): Promise<Profile> => {
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') throw new Error('Invalid profile')
    return { id: value.id }
  })
  const store = new RedisCacheStore(client, { namespace: 'profiles', codec })
  void store.set('one', { id: 'ok' }, 5000)
  // @ts-expect-error An asynchronous parser preserves the declared value schema.
  void store.set('two', { id: 12 }, 5000)
  // @ts-expect-error A codec for profiles cannot back a number store.
  new RedisCacheStore<number>(client, { namespace: 'numbers', codec })
}
