import { expect, it, vi } from 'vitest'
import { Cache, CacheClosedError, CacheStoreError } from './index.js'
import { MemoryCacheStore } from './memory.js'
import type { CacheStore } from './index.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

it('preserves the global receiver required by some host structuredClone implementations', async () => {
  const original = globalThis.structuredClone
  globalThis.structuredClone = function<T>(this: unknown, value: T): T {
    if (this !== globalThis) throw new TypeError('Illegal invocation')
    return original(value)
  }
  const cache = new Cache<{ value: number }>(new MemoryCacheStore())
  try {
    await cache.set('key', { value: 1 })
    expect(await cache.get('key')).toMatchObject({ value: { value: 1 } })
    expect(await cache.getOrLoad('loaded', async () => ({ value: 2 }))).toEqual({ value: 2 })
  } finally { await cache.close(); globalThis.structuredClone = original }
})

it('distinguishes misses from every falsy value, including cached undefined', async () => {
  const cache = new Cache<unknown>(new MemoryCacheStore())
  expect(await cache.get('missing')).toEqual({ hit: false })
  for (const value of [undefined, null, false, 0, '']) {
    await cache.set('key', value)
    expect(await cache.get('key')).toMatchObject({ hit: true, value })
    const loader = vi.fn(async () => 'unexpected')
    expect(await cache.getOrLoad('key', loader)).toBe(value)
    expect(loader).not.toHaveBeenCalled()
  }
  await cache.close()
})

it('uses exact lazy expiry, explicit no-expiry, zero retention, and loader-completion TTL', async () => {
  let now = 1000
  const cache = new Cache<number>(new MemoryCacheStore({ clock: () => now }), { ttlMs: 10 })
  await cache.set('key', 1)
  now = 1009; expect((await cache.get('key')).hit).toBe(true)
  now = 1010; expect(await cache.get('key')).toEqual({ hit: false })
  await cache.set('permanent', 2, { ttlMs: null })
  now = 9999; expect(await cache.get('permanent')).toEqual({ hit: true, value: 2, expiresAt: null })
  await cache.set('permanent', 3, { ttlMs: 0 })
  expect((await cache.get('permanent')).hit).toBe(false)
  const entered = deferred(); const gate = deferred()
  const loading = cache.getOrLoad('slow', async () => { entered.resolve(); await gate.promise; return 4 })
  await entered.promise; now = 10000; gate.resolve(); await loading
  expect(await cache.get('slow')).toEqual({ hit: true, value: 4, expiresAt: 10010 })
  await cache.close()
})

it('isolates original values, cache reads, and concurrent load waiters', async () => {
  const cache = new Cache<{ nested: { value: number } }>(new MemoryCacheStore())
  const original = { nested: { value: 1 } }
  const saving = cache.set('key', original)
  original.nested.value = 2
  await saving
  const first = await cache.get('key')
  if (!first.hit) throw new Error('missing')
  first.value.nested.value = 99
  expect(await cache.get('key')).toMatchObject({ value: { nested: { value: 1 } } })
  const entered = deferred(); const gate = deferred()
  const loader = vi.fn(async () => { entered.resolve(); await gate.promise; return { nested: { value: 3 } } })
  const a = cache.getOrLoad('load', loader)
  await entered.promise
  const b = cache.getOrLoad('load', loader)
  gate.resolve()
  const [one, two] = await Promise.all([a, b])
  one.nested.value = 7
  expect(two.nested.value).toBe(3)
  expect(loader).toHaveBeenCalledTimes(1)
  expect(await cache.get('load')).toMatchObject({ value: { nested: { value: 3 } } })
  await cache.close()
})

it('coalesces concurrent misses while unrelated keys load independently', async () => {
  const cache = new Cache<number>(new MemoryCacheStore())
  const entered = deferred(); const gate = deferred()
  const loader = vi.fn(async () => { entered.resolve(); await gate.promise; return 1 })
  const first = cache.getOrLoad('one', loader)
  await entered.promise
  const others = Array.from({ length: 20 }, () => cache.getOrLoad('one', loader))
  expect(await cache.getOrLoad('two', async () => 2)).toBe(2)
  gate.resolve()
  expect(await Promise.all([first, ...others])).toEqual(Array(21).fill(1))
  expect(loader).toHaveBeenCalledTimes(1)
  await cache.close()
})

it.each(['delete', 'clear'] as const)('does not repopulate from an older loader after %s', async (operation) => {
  const cache = new Cache<number>(new MemoryCacheStore())
  const entered = deferred(); const gate = deferred()
  const old = cache.getOrLoad('key', async () => { entered.resolve(); await gate.promise; return 1 })
  await entered.promise
  await (operation === 'clear' ? cache.clear() : cache.delete('key'))
  expect(await cache.getOrLoad('key', async () => 2)).toBe(2)
  gate.resolve()
  expect(await old).toBe(1)
  expect(await cache.get('key')).toMatchObject({ hit: true, value: 2 })
  await cache.close()
})

it('keeps explicit set ahead of an older load and allows a new generation to load', async () => {
  const cache = new Cache<number>(new MemoryCacheStore())
  const entered = deferred(); const gate = deferred()
  const old = cache.getOrLoad('key', async () => { entered.resolve(); await gate.promise; return 1 })
  await entered.promise
  await cache.set('key', 9)
  expect(await cache.getOrLoad('key', async () => 2)).toBe(9)
  gate.resolve(); expect(await old).toBe(1)
  expect(await cache.get('key')).toMatchObject({ value: 9 })
  await cache.close()
})

it('orders asynchronous provider writes with invalidation and clear barriers', async () => {
  const memory = new MemoryCacheStore<number>()
  const entered = deferred(); const gate = deferred()
  const store: CacheStore<number> = {
    get: (key) => memory.get(key), delete: (key) => memory.delete(key), clear: () => memory.clear(), close: () => memory.close(),
    set: async (key, value, ttl) => { if (value === 1) { entered.resolve(); await gate.promise }; await memory.set(key, value, ttl) },
  }
  const cache = new Cache(store)
  const setting = cache.set('key', 1)
  await entered.promise
  const clearing = cache.clear()
  const newer = cache.set('new', 2)
  gate.resolve(); await setting; await clearing; await newer
  expect((await cache.get('key')).hit).toBe(false)
  expect(await cache.get('new')).toMatchObject({ value: 2 })
  await cache.close()
})

it('does not cache loader errors and shares their failure before allowing retry', async () => {
  const cache = new Cache<number>(new MemoryCacheStore())
  const gate = deferred(); const entered = deferred(); const failure = new Error('backend unavailable')
  const loader = vi.fn(async () => { entered.resolve(); await gate.promise; throw failure })
  const first = cache.getOrLoad('key', loader)
  await entered.promise
  const second = cache.getOrLoad('key', loader)
  const rejected = Promise.all([expect(first).rejects.toBe(failure), expect(second).rejects.toBe(failure)])
  gate.resolve(); await rejected
  expect(loader).toHaveBeenCalledTimes(1)
  expect(await cache.getOrLoad('key', async () => 3)).toBe(3)
  await cache.close()
})

it('separates provider errors from loader errors without silently dropping them', async () => {
  const failure = new Error('provider unavailable')
  const memory = new MemoryCacheStore<number>()
  const cache = new Cache<number>({
    get: async () => { throw failure }, set: (...args) => memory.set(...args),
    delete: (key) => memory.delete(key), clear: () => memory.clear(), close: () => memory.close(),
  })
  await expect(cache.get('key')).rejects.toMatchObject({ name: 'CacheStoreError', operation: 'get', cause: failure })
  await expect(cache.getOrLoad('key', async () => 1)).rejects.toBeInstanceOf(CacheStoreError)
  await cache.close()
})

it('drains accepted loaders before closing the store and refuses new work', async () => {
  const memory = new MemoryCacheStore<number>()
  const close = vi.spyOn(memory, 'close')
  const cache = new Cache(memory)
  const entered = deferred(); const gate = deferred()
  const pending = cache.getOrLoad('key', async () => { entered.resolve(); await gate.promise; return 5 })
  await entered.promise
  const closing = cache.close()
  expect(cache.close()).toBe(closing)
  expect(cache.state).toBe('closing')
  expect(close).not.toHaveBeenCalled()
  await expect(cache.get('key')).rejects.toBeInstanceOf(CacheClosedError)
  await expect(cache.set('key', 1)).rejects.toBeInstanceOf(CacheClosedError)
  gate.resolve(); expect(await pending).toBe(5)
  await closing
  expect(close).toHaveBeenCalledTimes(1)
  expect(cache.state).toBe('closed')
})

it('retains cleanup failures and reaches a terminal state', async () => {
  const memory = new MemoryCacheStore<number>()
  vi.spyOn(memory, 'close').mockRejectedValue(new Error('close failed'))
  const cache = new Cache(memory)
  const closing = cache.close()
  await expect(closing).rejects.toMatchObject({ operation: 'close' })
  expect(cache.close()).toBe(closing)
  expect(cache.state).toBe('closed')
})

it('bounds store entries with LRU eviction and prunes expired values before eviction', async () => {
  let now = 1000
  const memory = new MemoryCacheStore<number>({ maxEntries: 2, clock: () => now })
  const cache = new Cache(memory)
  await cache.set('a', 1); await cache.set('b', 2)
  await cache.get('a')
  await cache.set('c', 3)
  expect((await cache.get('b')).hit).toBe(false)
  await cache.set('expired', 4, { ttlMs: 1 })
  now = 1001
  await cache.set('d', 5)
  expect(memory.size).toBe(2)
  expect((await cache.get('c')).hit).toBe(true)
  expect((await cache.get('expired')).hit).toBe(false)
  await cache.close()
})

it('validates keys, TTL, clocks, and unsupported copies without corrupting entries', async () => {
  expect(() => new Cache(new MemoryCacheStore(), { ttlMs: -1 })).toThrow('TTL')
  expect(() => new MemoryCacheStore({ maxEntries: 0 })).toThrow('capacity')
  const cache = new Cache<unknown>(new MemoryCacheStore())
  await expect(cache.get('')).rejects.toThrow('key')
  await cache.set('key', { value: 1 })
  await expect(cache.set('key', () => {})).rejects.toThrow()
  await expect(cache.set('key', 2, { ttlMs: Infinity })).rejects.toThrow('TTL')
  expect(await cache.get('key')).toMatchObject({ value: { value: 1 } })
  await cache.close()
  const invalid = new Cache(new MemoryCacheStore({ clock: () => NaN }))
  await expect(invalid.set('key', 1)).rejects.toMatchObject({ operation: 'set' })
  await invalid.close()
})
