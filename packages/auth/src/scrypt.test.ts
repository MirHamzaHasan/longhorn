import { expect, it, vi } from 'vitest'
import { createScryptPasswordHasher } from './scrypt.js'
import type { ScryptDriver } from './scrypt.js'

const encoded = 'scrypt$v=1$n=131072,r=8,p=1$' + '00'.repeat(16) + '$' + '11'.repeat(64)
const deferred = () => { let resolve!: (bytes: Uint8Array) => void, reject!: (error: Error) => void; const promise = new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const equal = (actual: Uint8Array, expected: Uint8Array) => actual.every((value, index) => value === expected[index]) // Test driver only.

it('retains v1 encoding, exact input, fixed native work and strict dummy verification', async () => {
  const derive = vi.fn<ScryptDriver['derive']>(async () => new Uint8Array(64).fill(17)), compare = vi.fn(equal)
  const passwords = createScryptPasswordHasher({ derive, equal: compare })
  const hash = await passwords.hash('  Unicode 🐮 passphrase  ')
  expect(hash).toMatch(/^scrypt\$v=1\$n=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  expect(derive.mock.calls[0]![0]).toBe('  Unicode 🐮 passphrase  ')
  expect(derive.mock.calls[0]![2]).toEqual({ N: 131072, r: 8, p: 1, maxmem: 268435456 })
  expect(Object.isFrozen(derive.mock.calls[0]![2])).toBe(true)
  expect(await passwords.verify('password', encoded)).toBe(true)
  expect(derive.mock.calls[1]![1]).toEqual(new Uint8Array(16))
  for (const malformed of [undefined, '', encoded.toUpperCase(), encoded + 'extra', encoded.replace('131072', '999999999'), encoded.slice(0, -2)]) {
    expect(await passwords.verify('password', malformed)).toBe(false)
  }
  expect(derive).toHaveBeenCalledTimes(8); expect(compare).toHaveBeenCalledTimes(7)
  expect(derive.mock.calls.slice(2).every(call => call[1].byteLength === 16 && call[2].N === 131072)).toBe(true)
})

it('keeps two native reservations, queues one and hands capacity on actual failure/completion', async () => {
  const gates = [deferred(), deferred(), deferred(), deferred()]
  let entered = 0, active = 0, peak = 0
  const passwords = createScryptPasswordHasher({ equal, derive: async () => {
    const gate = gates[entered++]!; active++; peak = Math.max(peak, active)
    try { return await gate.promise } finally { active-- }
  } }, { concurrency: 2, maxQueue: 1 })
  const first = passwords.hash('first'), second = passwords.verify('second', undefined), queued = passwords.hash('third')
  expect(entered).toBe(2)
  await expect(passwords.hash('fourth')).rejects.toMatchObject({ code: 'CAPACITY' })
  gates[0]!.reject(new Error('private native diagnostic password salt'))
  await expect(first).rejects.toThrow(/^Native password operation failed$/)
  expect(entered).toBe(3); expect(active).toBe(2); expect(peak).toBe(2)
  gates[1]!.resolve(new Uint8Array(64)); gates[2]!.resolve(new Uint8Array(64))
  expect(await second).toBe(false); await queued
  const next = passwords.hash('after drain'); expect(entered).toBe(4)
  gates[3]!.resolve(new Uint8Array(64)); await next; expect(active).toBe(0)
})

it('validates UTF-8 and worker limits before native admission and snapshots configured limits', async () => {
  const gate = deferred(), derive = vi.fn(async () => gate.promise), options = { concurrency: 1, maxQueue: 0 }
  const passwords = createScryptPasswordHasher({ derive, equal }, options)
  for (const value of ['x'.repeat(1025), 'é'.repeat(513), undefined as unknown as string]) await expect(passwords.hash(value)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(derive).not.toHaveBeenCalled()
  for (const options of [{ concurrency: 0 }, { concurrency: 5 }, { concurrency: NaN }, { maxQueue: -1 }, { maxQueue: 101 }]) expect(() => createScryptPasswordHasher({ derive, equal }, options)).toThrow('limits')
  options.concurrency = 4; options.maxQueue = 10
  const accepted = passwords.hash('x'.repeat(1024))
  await expect(passwords.verify('work', undefined)).rejects.toMatchObject({ code: 'CAPACITY' })
  gate.resolve(new Uint8Array(64)); await accepted
})

it('sanitizes failed or malformed native work and comparison without losing later capacity', async () => {
  let mode = 'wrong', compared = false
  const passwords = createScryptPasswordHasher({ derive: async () => {
    if (mode === 'throw') throw new Error('secret native password detail')
    return new Uint8Array(mode === 'wrong' ? 32 : 64)
  }, equal: () => { compared = true; throw new Error('secret comparison diagnostic') } })
  for (mode of ['wrong', 'throw']) {
    await expect(passwords.hash('password')).rejects.toThrow(/^Native password operation failed$/)
    expect(compared).toBe(false)
  }
  mode = 'valid'
  expect(await passwords.hash('password')).toContain('scrypt$v=1$')
  await expect(passwords.verify('password', encoded)).rejects.toThrow(/^Native password operation failed$/)
  expect(compared).toBe(true)
})
