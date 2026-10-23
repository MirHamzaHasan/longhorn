import { describe, expect, it } from 'vitest'
import { Idempotency, IdempotencyInputError, validIdempotencyKey } from './index.js'
import type { IdempotencyStore, JsonValue } from './index.js'
import { jsonSnapshot } from './json.js'

describe('strict idempotency snapshots', () => {
  it('canonicalizes object keys recursively and preserves array order and literal __proto__ keys', () => {
    expect(jsonSnapshot({ z: [{ b: 2, a: 1 }], a: -0 }, 100)).toBe('{"a":0,"z":[{"a":1,"b":2}]}')
    expect(jsonSnapshot(JSON.parse('{"__proto__":{"safe":true}}'), 100)).toBe('{"__proto__":{"safe":true}}')
  })
  it('rejects lossy values, coercions, accessors, cycles and sparse arrays without invoking getters', () => {
    let calls = 0
    const getter = { get value() { calls++; return 1 } }, cycle: Record<string, unknown> = {}; cycle.self = cycle
    for (const value of [undefined, NaN, Infinity, 1n, new Date(), new Map(), { a: undefined }, [undefined], new Array(1), getter, cycle, { [Symbol()]: 1 }]) {
      expect(() => jsonSnapshot(value, 1000)).toThrow(IdempotencyInputError)
    }
    expect(calls).toBe(0)
  })
  it('bounds UTF-8 bytes and nesting; repeated noncyclic references remain JSON', () => {
    expect(jsonSnapshot('é', 4)).toBe('"é"')
    expect(() => jsonSnapshot('é', 3)).toThrow('byte limit')
    let value: JsonValue = null
    for (let i = 0; i < 34; i++) value = [value]
    expect(() => jsonSnapshot(value, 1000)).toThrow('depth limit')
    const shared = { x: 1 }; expect(jsonSnapshot([shared, shared], 100)).toBe('[{"x":1},{"x":1}]')
  })
})
it('snapshots before hashing, preserves normalized fingerprints and clones saved JSON results', async () => {
  const requests: string[] = [], results: string[] = []
  const store: IdempotencyStore = {
    async run(request, work) { requests.push(request.fingerprint); const result = await work({ execute: async () => { throw new Error('unused') } }); results.push(result); return { result, replayed: false, expiresAt: 123 } },
    async prune() { return 0 },
  }
  const service = new Idempotency({ store }), input = { b: 2, a: 1 }, value = { result: 'saved' }
  const first = service.run({ scope: 'tasks:v1', key: 'key', input }, async () => value)
  input.a = 9
  const outcome = await first; value.result = 'changed'
  expect(outcome.value.result).toBe('saved')
  await service.run({ scope: 'tasks:v1', key: 'key', input: { a: 1, b: 2 } }, async () => ({ result: 'saved' }))
  expect(requests[0]).toMatch(/^[0-9a-f]{64}$/); expect(requests[0]).toBe(requests[1]); expect(results[0]).toBe('{"result":"saved"}')
})
it('validates keys, scopes, bounds and pruning before reaching storage', async () => {
  let calls = 0
  const service = new Idempotency({ store: { async run() { calls++; throw new Error('unused') }, async prune() { calls++; return 0 } } })
  for (const key of ['', ' space', 'has/slash', 'x'.repeat(201), '☃', 'a,b', 'a\nb']) {
    expect(validIdempotencyKey(key)).toBe(false)
    await expect(service.run({ scope: 'tasks:v1', key, input: {} }, async () => ({}))).rejects.toThrow('key')
  }
  await expect(service.run({ scope: '../invalid space', key: 'ok', input: {} }, async () => ({}))).rejects.toThrow('scope')
  expect(() => service.prune(0)).toThrow('prune limit')
  expect(() => new Idempotency({ store: {} as IdempotencyStore, retentionMs: Infinity })).toThrow('retentionMs')
  expect(calls).toBe(0)
})
