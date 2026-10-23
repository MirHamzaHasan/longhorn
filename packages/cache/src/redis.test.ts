import { expect, it, vi } from 'vitest'
import { Cache } from './cache.js'
import { jsonCacheCodec } from './codec.js'
import { RedisCacheStore } from './redis.js'
import type { RedisCommandClient } from './redis.js'
const codec = jsonCacheCodec(value => value)
function fixture(replies: unknown[]) {
  const calls: string[][] = [], close = vi.fn(async () => {})
  const client: RedisCommandClient = { async execute(command) { calls.push([...command]); return replies.shift() }, close }
  return { store: new RedisCacheStore(client, { namespace: 'one', codec }), client, calls, close }
}
it('keeps miss/falsy hits and server expiry distinct without using a client clock', async () => {
  const state = fixture([[], ['[1,"undefined"]', -1], ['[1,"value",false]', 100], ['[1,"value",0]', -1]])
  expect(await state.store.get('missing')).toEqual({ hit: false })
  expect(await state.store.get('undefined')).toEqual({ hit: true, value: undefined, expiresAt: null })
  expect(await state.store.get('false')).toEqual({ hit: true, value: false, expiresAt: 100 })
  expect(await state.store.get('zero')).toEqual({ hit: true, value: 0, expiresAt: null })
  expect(state.calls.every(command => command[0] === 'EVAL' && command[1]!.includes('PEXPIRETIME') && command[2] === '1')).toBe(true)
})
it('encodes Unicode and glob-like keys injectively and never lets a key become a namespace pattern', async () => {
  const state = fixture(['OK', 'OK', 'OK', 'OK', 'OK'])
  for (const key of ['a:*[]', '雪', '\0', '\uFEFFkey', 'key']) await state.store.set(key, 1, null)
  const names = state.calls.map(command => command[3]!)
  expect(new Set(names).size).toBe(5)
  expect(names.every(name => /^longhorn:cache:v1:one:[A-Za-z0-9_-]+$/.test(name))).toBe(true)
  const before = state.calls.length
  await expect(state.store.get('\uD800')).rejects.toMatchObject({ code: 'key' })
  await expect(state.store.get('x'.repeat(1025))).rejects.toMatchObject({ code: 'key' })
  expect(state.calls).toHaveLength(before)
  for (const namespace of ['', '*', 'one:two', 'a'.repeat(65)]) expect(() => new RedisCacheStore(state.client, { namespace, codec })).toThrow('namespace')
})
it('zero TTL removes an entry without serializing a value and invalid writes reach no command', async () => {
  const state = fixture([1]), encode = vi.fn(() => { throw new Error('must not serialize') })
  const store = new RedisCacheStore(state.client, { namespace: 'zero', codec: { encode, decode: () => undefined } })
  await store.set('key', undefined, 0)
  expect(encode).not.toHaveBeenCalled(); expect(state.calls[0]![0]).toBe('UNLINK')
  for (const ttl of [-1, NaN, Infinity]) await expect(store.set('key', undefined, ttl)).rejects.toThrow('TTL')
  const tooLarge = new RedisCacheStore(state.client, { namespace: 'size', codec, maxValueBytes: 16 })
  await expect(tooLarge.set('key', 'too long for the configured value budget', null)).rejects.toMatchObject({ code: 'value' })
  expect(state.calls).toHaveLength(1)
})
it('rejects malformed provider replies and serialized values rather than inventing a hit', async () => {
  for (const reply of [null, 'wrong', [1, -1], ['[1,"value",1]', -2], ['[1,"value",1]', Number.MAX_SAFE_INTEGER + 1], ['bad-private-json', -1]]) {
    const { store } = fixture([reply]); await expect(store.get('key')).rejects.toThrow()
  }
})
it('clears only its namespace with bounded deletion chunks despite SCAN count being a hint', async () => {
  const prefix = 'longhorn:cache:v1:one:', state = fixture([['123', [1,2,3,4,5].map(n => prefix + n)], 2, 2, 1, ['0', []]])
  const store = new RedisCacheStore(state.client, { namespace: 'one', codec, scanCount: 2 })
  await store.clear()
  expect(state.calls.filter(command => command[0] === 'UNLINK').map(command => command.length - 1)).toEqual([2, 2, 1])
  expect(state.calls.filter(command => command[0] === 'SCAN').map(command => command[1])).toEqual(['0', '123'])
  expect(state.calls.every(command => !command.includes('FLUSHDB') && !command.includes('KEYS'))).toBe(true)
  const foreign = fixture([['0', ['another:namespace:key']]])
  await expect(foreign.store.clear()).rejects.toMatchObject({ code: 'protocol' }); expect(foreign.calls).toHaveLength(1)
  const endless = fixture([['123', []]])
  await expect(new RedisCacheStore(endless.client, { namespace: 'one', codec, maxScanPages: 1 }).clear()).rejects.toMatchObject({ code: 'scan-limit' })
})
it('bounds accepted operations and drains asynchronous codecs before releasing its owned connection', async () => {
  let release!: (value: number) => void
  const state = fixture([['raw', -1]])
  const store = new RedisCacheStore(state.client, { namespace: 'one', maxConcurrent: 1, codec: { encode: String, decode: () => new Promise<number>(resolve => { release = resolve }) } })
  const read = store.get('key'); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(store.get('another')).rejects.toMatchObject({ code: 'capacity' })
  const closing = store.close(); expect(store.close()).toBe(closing); expect(state.close).not.toHaveBeenCalled()
  await expect(store.get('key')).rejects.toMatchObject({ code: 'closed' })
  release(42); expect(await read).toMatchObject({ hit: true, value: 42 }); await closing; expect(state.close).toHaveBeenCalledOnce()
})
it('keeps provider failure classification in the existing Cache manager', async () => {
  const state = fixture([['0', ['outside:key']]]), cache = new Cache(state.store)
  await expect(cache.clear()).rejects.toMatchObject({ operation: 'clear', cause: { code: 'protocol' } })
  await cache.close()
})
