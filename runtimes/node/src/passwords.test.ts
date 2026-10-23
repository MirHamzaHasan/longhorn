import { expect, it } from 'vitest'
import { createScryptPasswordHasher } from './passwords.js'

it('uses native scrypt with independent salts, strict parameters, and exact password comparison', async () => {
  const passwords = createScryptPasswordHasher()
  const first = await passwords.hash('  a long passphrase here  ')
  const second = await passwords.hash('  a long passphrase here  ')
  expect(first).toMatch(/^scrypt\$v=1\$n=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  expect(first).not.toBe(second)
  expect(await passwords.verify('  a long passphrase here  ', first)).toBe(true)
  expect(await passwords.verify('a long passphrase here', first)).toBe(false)
  expect(await passwords.verify('wrong', first)).toBe(false)
}, 15000)

it('reserves real worker capacity for missing and malformed hashes and bounds the queue', async () => {
  const passwords = createScryptPasswordHasher({ concurrency: 1, maxQueue: 0 })
  for (const encoded of [undefined, 'scrypt$v=1$n=999999999,r=8,p=1$bad$bad']) {
    const dummy = passwords.verify('a password', encoded)
    await expect(passwords.hash('another password')).rejects.toMatchObject({ code: 'CAPACITY' })
    expect(await dummy).toBe(false)
  }
  const queued = createScryptPasswordHasher({ concurrency: 1, maxQueue: 1 })
  const one = queued.hash('one password')
  const two = queued.hash('two password')
  await expect(queued.hash('three password')).rejects.toMatchObject({ code: 'CAPACITY' })
  const results = await Promise.all([one, two])
  expect(results).toHaveLength(2)
}, 15000)

it('rejects invalid worker limits and oversized password work', async () => {
  expect(() => createScryptPasswordHasher({ concurrency: 0 })).toThrow('limits')
  expect(() => createScryptPasswordHasher({ maxQueue: -1 })).toThrow('limits')
  await expect(createScryptPasswordHasher().hash('x'.repeat(1025))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
})
