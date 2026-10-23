import { expect, it, vi } from 'vitest'
import { AuthError, AuthService } from './credentials.js'
import { SessionManager } from './sessions.js'
import { MemoryAuthStore, testPasswords } from './test-support.js'

const password = '  a long passphrase  '

it('normalizes public usernames, fixes registration roles, and never returns credential fields', async () => {
  const store = new MemoryAuthStore()
  const auth = new AuthService(store, testPasswords)
  const user = await auth.register('  APerson  ', password)
  expect(user).toEqual({ id: expect.any(String), username: 'aperson', roles: ['member'] })
  expect(Object.isFrozen(user)).toBe(true)
  expect(Object.isFrozen(user.roles)).toBe(true)
  expect(store.users.get(user.id)?.passwordHash).toBe(`fixture:${password}`)
  await expect(auth.register('APERSON', password)).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
})

it('enforces bounded inputs without trimming passwords or doing password work on invalid signup', async () => {
  const hash = vi.fn(testPasswords.hash)
  const auth = new AuthService(new MemoryAuthStore(), { ...testPasswords, hash })
  for (const [username, value] of [['ab', password], ['bad username', password], ['valid', 'short'], ['valid', 'x'.repeat(129)]]) {
    await expect(auth.register(username!, value!)).rejects.toBeInstanceOf(AuthError)
  }
  expect(hash).not.toHaveBeenCalled()
  await auth.register('valid', password)
  expect(hash).toHaveBeenLastCalledWith(password)
  await expect(auth.login('valid', password.trim())).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
})

it('uses password verification for unknown users and gives identical credential errors', async () => {
  const verify = vi.fn(testPasswords.verify)
  const auth = new AuthService(new MemoryAuthStore(), { ...testPasswords, verify })
  await auth.register('known', password)
  for (const username of ['known', 'unknown']) {
    await expect(auth.login(username, 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' })
  }
  expect(verify).toHaveBeenLastCalledWith('wrong', undefined)
})

it('stores only token hashes, rotates a supplied session, and revokes every device', async () => {
  const store = new MemoryAuthStore()
  const auth = new AuthService(store, testPasswords)
  const user = await auth.register('person', password)
  const first = await auth.login('person', password)
  expect(first.session.token).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify([...store.sessions.values()])).not.toContain(first.session.token)
  const second = await auth.login('person', password, first.session.token)
  expect(second.session.token).not.toBe(first.session.token)
  expect(await auth.authenticate(first.session.token)).toBeUndefined()
  expect((await auth.authenticate(second.session.token))?.user).toEqual(user)
  const third = await auth.login('person', password)
  await auth.revokeAll(user.id)
  expect(await auth.authenticate(second.session.token)).toBeUndefined()
  expect(await auth.authenticate(third.session.token)).toBeUndefined()
})

it('enforces absolute expiry exactly at the boundary and purges expired records', async () => {
  let now = 1000
  const store = new MemoryAuthStore()
  const auth = new AuthService(store, testPasswords, { clock: () => now, sessionTtlMs: 1000 })
  await auth.register('person', password)
  const first = await auth.login('person', password)
  const second = await auth.login('person', password)
  now = 1999
  expect(await auth.authenticate(first.session.token)).toBeDefined()
  now = 2000
  expect(await auth.authenticate(first.session.token)).toBeUndefined()
  expect(await auth.sessions.purgeExpired()).toBe(1)
  expect(await auth.authenticate(second.session.token)).toBeUndefined()
})

it('loads current roles on every request and rejects a deleted account', async () => {
  const store = new MemoryAuthStore()
  const auth = new AuthService(store, testPasswords)
  const user = await auth.register('person', password)
  const { session } = await auth.login('person', password)
  store.users.set(user.id, { ...store.users.get(user.id)!, roles: ['admin'] })
  expect((await auth.authenticate(session.token))?.user.roles).toEqual(['admin'])
  store.users.delete(user.id)
  expect(await auth.authenticate(session.token)).toBeUndefined()
  expect(store.sessions.size).toBe(0)
})

it('throttles normalized account attempts, resets the window, and clears failures on success', async () => {
  let now = 1000
  const auth = new AuthService(new MemoryAuthStore(), testPasswords, { clock: () => now, loginLimit: 2, loginWindowMs: 1000 })
  await auth.register('person', password)
  await expect(auth.login('person', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(auth.login('PERSON', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(auth.login(' person ', password)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 1000 })
  now = 2000
  await auth.login('person', password)
  await auth.login('person', password)
  await auth.login('person', password)
})

it('does not authenticate malformed tokens or hide storage failures as anonymous requests', async () => {
  const store = new MemoryAuthStore()
  const find = vi.spyOn(store, 'findSession')
  const sessions = new SessionManager(store)
  for (const value of [undefined, '', 'short', 'A'.repeat(64), 'a'.repeat(65)]) expect(await sessions.authenticate(value)).toBeUndefined()
  expect(find).not.toHaveBeenCalled()
  find.mockRejectedValue(new Error('store offline'))
  await expect(sessions.authenticate('a'.repeat(64))).rejects.toThrow('store offline')
})

it('validates lifetimes, clocks, and throttle settings', async () => {
  const store = new MemoryAuthStore()
  for (const ttlMs of [0, 999, NaN, 2592000001]) expect(() => new SessionManager(store, { ttlMs })).toThrow('lifetime')
  expect(() => new AuthService(store, testPasswords, { loginLimit: 0 })).toThrow('throttle')
  await expect(new SessionManager(store, { clock: () => NaN }).create('person')).rejects.toThrow('clock')
})
