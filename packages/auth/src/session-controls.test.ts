import { expect, it, vi } from 'vitest'
import { AuthService } from './credentials.js'
import { tokenHash } from './sessions.js'
import { MemoryAuthStore, testPasswords } from './test-support.js'
import type { SessionControlScope } from './types.js'
const token = 'a'.repeat(64)

it('keeps legacy custom stores compatible and requires explicit supported session control opt-in', async () => {
  const store = new MemoryAuthStore(), legacy = new AuthService(store, testPasswords)
  await expect(legacy.revokeSessions(token, 'others')).rejects.toThrow('not enabled')
  expect(() => new AuthService(store, testPasswords, { sessionControls: true })).toThrow('does not support')
  expect(() => new AuthService(store, testPasswords, { sessionControls: 'yes' as unknown as boolean })).toThrow('Invalid session control setting')
})
it('validates token/scope before storage and gives the captured capability frozen hash-only input', async () => {
  const revoke = vi.fn(async () => 2), store = Object.assign(new MemoryAuthStore(), { sessionControls: { revoke } })
  const auth = new AuthService(store, testPasswords, { sessionControls: true, clock: () => 1000 })
  store.sessionControls.revoke = vi.fn(async () => { throw new Error('substituted') })
  await expect(auth.revokeSessions(undefined, 'others')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(auth.revokeSessions(token, 'invalid' as SessionControlScope)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(revoke).not.toHaveBeenCalled()
  expect(await auth.revokeSessions(token, 'others')).toEqual({ revokedSessions: 2 })
  const [input, clock] = revoke.mock.calls[0] as unknown as [{tokenHash:string;scope:string},()=>number]
  expect(input).toEqual({ tokenHash: await tokenHash(token), scope: 'others' }); expect(Object.isFrozen(input)).toBe(true); expect(clock()).toBe(1000)
  expect(JSON.stringify(input)).not.toContain(token)
})
it('distinguishes valid zero-other revocation from stale initiation and invalid capability counts', async () => {
  let count: number | undefined = 0
  const store = Object.assign(new MemoryAuthStore(), { sessionControls: { revoke: async () => count } })
  const auth = new AuthService(store, testPasswords, { sessionControls: true })
  expect(await auth.revokeSessions(token, 'others')).toEqual({ revokedSessions: 0 })
  await expect(auth.revokeSessions(token, 'all')).rejects.toThrow('Invalid session control result')
  count = undefined; await expect(auth.revokeSessions(token, 'all')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  for (count of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) await expect(auth.revokeSessions(token, 'others')).rejects.toThrow('Invalid session control result')
})
it('propagates commit failures and rejects an invalid operation clock', async () => {
  const failure = new Error('native commit failed'), store = Object.assign(new MemoryAuthStore(), { sessionControls: { revoke: async (_input: unknown, now: () => number) => { now(); throw failure } } })
  const invalid = new AuthService(store, testPasswords, { sessionControls: true, clock: () => -1 })
  await expect(invalid.revokeSessions(token, 'others')).rejects.toThrow('Invalid authentication clock')
  await expect(new AuthService(store, testPasswords, { sessionControls: true }).revokeSessions(token, 'all')).rejects.toBe(failure)
})
