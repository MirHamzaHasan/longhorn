import { expect, it } from 'vitest'
import { CacheCodecError, jsonCacheCodec } from './codec.js'

it('roundtrips JSON values and distinct top-level undefined through a versioned codec', async () => {
  const codec = jsonCacheCodec(value => value)
  for (const value of [undefined, null, false, 0, '', [], { key: '雪', numbers: [1, 2] }]) expect(await codec.decode(await codec.encode(value))).toEqual(value)
  expect(await codec.encode({ b: 2, a: 1 })).toBe(await codec.encode({ a: 1, b: 2 }))
})
it('rejects lossy/active object shapes without executing getters or toJSON', async () => {
  const codec = jsonCacheCodec(value => value), cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  let executed = 0
  const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { executed++; return 'private' } })
  const custom = { toJSON() { executed++; return {} } }
  for (const value of [NaN, Infinity, 1n, new Date(), new Map(), Promise.resolve(1), () => 1, [undefined], { value: undefined }, Array(1), cyclic, getter, custom, Object.defineProperty({}, 'hidden', { value: 1 }), { [Symbol()]: 1 }]) await expect(codec.encode(value)).rejects.toThrow(CacheCodecError)
  expect(executed).toBe(0)
})
it('enforces UTF-8 byte/depth limits and sanitizes malformed or schema-invalid data', async () => {
  const codec = jsonCacheCodec(value => { if (typeof value !== 'string') throw new Error('private schema input'); return value }, { maxBytes: 32 })
  await expect(codec.encode('雪'.repeat(10))).rejects.toThrow(CacheCodecError)
  for (const value of ['secret-not-json', '[2,"value","x"]', '[1,"undefined",0]', '[1,"value",null]', '[1,"value","' + 'a'.repeat(40) + '"]']) {
    try { await codec.decode(value); throw new Error('Expected invalid data') } catch (error) { expect(error).toBeInstanceOf(CacheCodecError); expect(String(error)).not.toContain('secret') }
  }
  let deep: unknown = 1; for (let n = 0; n < 34; n++) deep = [deep]
  await expect(jsonCacheCodec(value => value).encode(deep)).rejects.toThrow(CacheCodecError)
  for (const maxBytes of [0, 15, Infinity, 1048577]) expect(() => jsonCacheCodec(value => value, { maxBytes })).toThrow('limit')
})
it('gives application validation detached JSON data and rejects non-JSON parser outputs', async () => {
  const input = { count: 1 }, codec = jsonCacheCodec(value => { const object = value as { count: number }; object.count++; return object })
  const encoded = await codec.encode(input)
  expect(input.count).toBe(1)
  expect(JSON.parse(encoded)).toEqual([1, 'value', { count: 2 }])
  await expect(jsonCacheCodec(() => new Date()).decode('[1,"value",{}]')).rejects.toThrow(CacheCodecError)
})
it('awaits asynchronous schema work and contains rejected parser details', async () => {
  const codec = jsonCacheCodec(async value => { await Promise.resolve(); if (typeof value !== 'number') throw new Error('private validation detail'); return value })
  expect(await codec.decode(await codec.encode(42))).toBe(42)
  await expect(codec.decode('[1,"value","invalid"]')).rejects.toEqual(new CacheCodecError())
})
