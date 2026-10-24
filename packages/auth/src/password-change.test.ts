import { expect, it, vi } from 'vitest'
import { AuthService } from './credentials.js'
import { SessionManager } from './sessions.js'
import type { AuthStore } from './types.js'
import { MemoryAuthStore, testPasswords } from './test-support.js'

const password = '  a long fixture 🐮 password  ', nextPassword = 'a different fixture 🐮 password '
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }

it('changes exact password input and atomically revokes every subject session while preserving peers and roles', async () => {
  const store = new MemoryAuthStore(), auth = new AuthService(store, testPasswords, { passwordChanges: true })
  const alice = await auth.register('alice', password); await auth.register('bob', password)
  const first = await auth.login('alice', password), second = await auth.login('alice', password), bob = await auth.login('bob', password)
  Object.assign(store.users.get(alice.id)!, { roles: ['admin'] })
  await auth.changePassword(first.session.token, password, nextPassword)
  expect(store.users.get(alice.id)?.passwordHash).toBe('fixture:' + nextPassword)
  expect(store.users.get(alice.id)?.roles).toEqual(['admin'])
  expect(await auth.authenticate(first.session.token)).toBeUndefined(); expect(await auth.authenticate(second.session.token)).toBeUndefined()
  expect(await auth.authenticate(bob.session.token)).toBeDefined()
  await expect(auth.login('alice', password)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(auth.login('alice', nextPassword.trim())).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect((await auth.login('alice', nextPassword)).user.roles).toEqual(['admin'])
})

it('rejects invalid/no-op input before hashing, requires opt-in capability, and charges wrong current passwords to the durable account limit', async () => {
  const store = new MemoryAuthStore(), hash = vi.fn(testPasswords.hash)
  const disabled = new AuthService(store, { ...testPasswords, hash })
  await expect(disabled.changePassword(undefined, password, nextPassword)).rejects.toThrow('not enabled')
  const legacy = Object.create(store) as AuthStore
  Object.defineProperty(legacy, 'passwordChanges', { value: undefined })
  expect(() => new AuthService(legacy, testPasswords, { passwordChanges: true })).toThrow('does not support')
  const auth = new AuthService(store, { ...testPasswords, hash }, { passwordChanges: true, loginLimit: 2 })
  await auth.register('alice', password); const session = (await auth.login('alice', password)).session
  hash.mockClear()
  for (const value of ['short', password, 'x'.repeat(129)]) await expect(auth.changePassword(session.token, password, value)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(auth.changePassword(session.token, '\ud800' + password, '\ufffd' + password)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(auth.changePassword(undefined, password, nextPassword)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  for (let index = 0; index < 2; index++) await expect(auth.changePassword(session.token, 'wrong', nextPassword)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(auth.changePassword(session.token, password, nextPassword)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  expect(hash).not.toHaveBeenCalled(); expect(await auth.authenticate(session.token)).toBeDefined()
})

it('fences an old-password login already doing verification when another process changes credentials', async () => {
  const store = new MemoryAuthStore(), entered = deferred(), release = deferred()
  const changer = new AuthService(store, testPasswords, { passwordChanges: true })
  await changer.register('alice', password); const session = (await changer.login('alice', password)).session
  const delayed = new AuthService(store, { ...testPasswords, verify: async (value, hash) => {
    entered.resolve(); await release.promise; return testPasswords.verify(value, hash)
  } }) // A current login-only host still fences issuance without exposing password changes.
  const login = delayed.login('alice', password, session.token)
  await entered.promise
  await changer.changePassword(session.token, password, nextPassword)
  release.resolve(); await expect(login).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect(store.sessions.size).toBe(0)
  await changer.login('alice', nextPassword)
})

it('snapshots mutable credential records before native verification instead of accepting an overwritten hash', async () => {
  const store = new MemoryAuthStore(), entered = deferred(), release = deferred()
  const auth = new AuthService(store, { ...testPasswords, verify: async () => { entered.resolve(); await release.promise; return true } }, { passwordChanges: true })
  const user = await auth.register('alice', password)
  const login = auth.login('alice', password); await entered.promise
  Object.assign(store.users.get(user.id)!, { passwordHash: 'fixture:replacement' })
  release.resolve(); await expect(login).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect(store.sessions.size).toBe(0)
})

it('rejects concurrent stale password replacement, revoked sessions and expiry after password work', async () => {
  let now = 1000
  const store = new MemoryAuthStore(), plain = new AuthService(store, testPasswords, { passwordChanges: true, clock: () => now, sessionTtlMs: 1000 })
  const entered = deferred(), release = deferred()
  const delayed = new AuthService(store, { ...testPasswords, hash: async value => { entered.resolve(); await release.promise; return testPasswords.hash(value) } },
    { passwordChanges: true, clock: () => now, sessionTtlMs: 1000 })
  const user = await plain.register('alice', password), token = (await plain.login('alice', password)).session.token
  const first = delayed.changePassword(token, password, nextPassword); await entered.promise
  await plain.changePassword(token, password, 'a third different passphrase')
  release.resolve(); await expect(first).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect(store.users.get(user.id)?.passwordHash).toBe('fixture:a third different passphrase')
  const session = (await plain.login('alice', 'a third different passphrase')).session
  const expired = new AuthService(store, { ...testPasswords, hash: async value => { now = 2000; return testPasswords.hash(value) } },
    { passwordChanges: true, clock: () => now, sessionTtlMs: 1000 })
  await expect(expired.changePassword(session.token, 'a third different passphrase', nextPassword)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect(store.users.get(user.id)?.passwordHash).toBe('fixture:a third different passphrase')
})

it('keeps a generated session token private until a trusted conditional commit succeeds', async () => {
  const manager = new SessionManager(new MemoryAuthStore(), { clock: () => 1000, ttlMs: 1000 })
  let candidate: unknown
  expect(await manager.createIf('alice', async session => { candidate = session; return false })).toBeUndefined()
  expect(candidate).toEqual({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), userId: 'alice', expiresAt: 2000 })
  expect(Object.isFrozen(candidate)).toBe(true)
  await expect(manager.createIf('alice', async () => undefined as unknown as boolean)).rejects.toThrow('Invalid session commit')
  await expect(manager.createIf('alice', async () => { throw new Error('store unavailable') })).rejects.toThrow('store unavailable')
})
