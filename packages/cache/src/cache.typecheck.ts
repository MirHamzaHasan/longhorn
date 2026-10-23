import { Cache } from './index.js'
import { MemoryCacheStore } from './memory.js'

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
