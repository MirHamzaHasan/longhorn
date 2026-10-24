import { expect, it, vi } from 'vitest'
import { SessionInventory } from './session-inventory.js'
import { tokenHash } from './sessions.js'
import type { SessionInventoryStore } from './session-inventory.js'
const token = 'a'.repeat(64), first = '1'.repeat(32), second = '2'.repeat(32), owner = 'owned-user'
function fixture() {
  const list = vi.fn<SessionInventoryStore['list']>(async (_input, now) => { now(); return { sessions: [{ id: first, expiresAt: 200, current: true }], next: null } })
  const revoke = vi.fn<SessionInventoryStore['revoke']>(async (_input, now) => { now(); return { revokedSessions: 1, current: false } })
  return { list, revoke }
}
it('captures the store and frozen hash-only input while exposing only public references', async () => {
  const store = fixture(), list = store.list, inventory = new SessionInventory(store, { clock: () => 100 })
  store.list = vi.fn(async () => { throw new Error('substituted') })
  const page = await inventory.list(token); expect(page).toEqual({ sessions: [{ id: first, expiresAt: 200, current: true }], nextCursor: null })
  expect(list.mock.calls[0]?.[0]).toEqual({ tokenHash: await tokenHash(token), limit: 10, after: null }); expect(Object.isFrozen(list.mock.calls[0]?.[0])).toBe(true)
  expect(JSON.stringify(page)).not.toContain(token); expect(JSON.stringify(page)).not.toContain(await tokenHash(token)); expect(Object.isFrozen(page.sessions)).toBe(true)
})
it('copies pagination options and retains account/session binding in a bounded continuation', async () => {
  const store = fixture(); store.list.mockImplementation(async (input, now) => { now(); return input.after ? { sessions: [{ id: second, expiresAt: 200, current: false }], next: null } : { sessions: [{ id: first, expiresAt: 200, current: true }], next: { owner, initiator: first, id: first, expiresAt: 200, privateToken: 'must-not-encode' } } })
  const inventory = new SessionInventory(store, { clock: () => 100 }), options = { limit: 1 }, pending = inventory.list(token, options); options.limit = 2
  const page = await pending; expect(atob(page.nextCursor!.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('must-not-encode'); expect(store.list.mock.calls[0]?.[0].limit).toBe(1)
  expect((await inventory.list(token, { limit: 1, cursor: page.nextCursor! })).sessions[0]?.id).toBe(second)
  expect(store.list.mock.calls[1]?.[0].after).toEqual({ owner, initiator: first, id: first, expiresAt: 200 }); expect(Object.isFrozen(store.list.mock.calls[1]?.[0].after)).toBe(true)
})
it('rejects invalid input before storage and stale initiation after native ownership', async () => {
  const store = fixture(), inventory = new SessionInventory(store)
  await expect(inventory.list(undefined)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: '' }, { cursor: 'x'.repeat(2049) }, { cursor: 'private input' }]) await expect(inventory.list(token, options)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(inventory.revoke(token, 'not-a-reference')).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(store.list).not.toHaveBeenCalled(); expect(store.revoke).not.toHaveBeenCalled()
  store.list.mockResolvedValue(undefined); store.revoke.mockResolvedValue(undefined)
  await expect(inventory.list(token)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' }); await expect(inventory.revoke(token, first)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
})
it('fails closed on malformed, expired, duplicate, unordered or unowned observations', async () => {
  const store = fixture(), inventory = new SessionInventory(store, { clock: () => 100 })
  for (const sessions of [[{ id: first, expiresAt: 100, current: false }], [{ id: first, expiresAt: 200, current: 'yes' }], [{ id: second, expiresAt: 200, current: false }, { id: first, expiresAt: 200, current: false }], [{ id: first, expiresAt: 200, current: true }, { id: second, expiresAt: 200, current: true }]]) {
    store.list.mockImplementation(async (_input, now) => { now(); return { sessions: sessions as never, next: null } }); await expect(inventory.list(token)).rejects.toThrow('Invalid session inventory')
  }
  store.list.mockResolvedValue({ sessions: [], next: null }); await expect(inventory.list(token)).rejects.toThrow('Invalid session inventory page')
  store.list.mockImplementation(async (_input, now) => { now(); now(); return { sessions: [], next: null } }); await expect(inventory.list(token)).rejects.toThrow('sampled twice')
})
it('validates bounded revocation results and propagates original commit errors', async () => {
  const store = fixture(), inventory = new SessionInventory(store, { clock: () => 100 })
  expect(await inventory.revoke(token, second)).toEqual({ revokedSessions: 1, current: false })
  for (const value of [{ revokedSessions: 2, current: false }, { revokedSessions: 0, current: true }, { revokedSessions: 1, current: 'yes' }]) { store.revoke.mockImplementation(async (_input, now) => { now(); return value as never }); await expect(inventory.revoke(token, second)).rejects.toThrow('Invalid session inventory revocation') }
  const problem = new Error('native commit failure'); store.revoke.mockRejectedValue(problem); await expect(inventory.revoke(token, second)).rejects.toBe(problem)
})
