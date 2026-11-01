import { afterEach, expect, it } from 'vitest'
import { migrate } from '@longhornjs/database'
import type { Database } from '@longhornjs/database'
import { AuthError, AuthService, PasswordResetError, PasswordResets } from '@longhornjs/auth'
import type { PasswordResetDelivery } from '@longhornjs/auth'
import { authMigrations, SqliteAuthStore, SqlitePasswordResetStore, sqlitePasswordResetMigrations } from '@longhornjs/auth/sqlite'
import { openSqlite } from './sqlite.js'

const passwords = { hash: async (value: string) => 'fixture:' + value, verify: async (value: string, encoded: string | undefined) => encoded === 'fixture:' + value }
const current = 'a fixture current passphrase', next = 'a different fixture passphrase', third = 'yet another fixture passphrase'
const handles: Database[] = []
afterEach(async () => { await Promise.all(handles.splice(0).map(database => database.close())) })
async function setup(options: { failDelivery?: boolean; requestLimit?: number } = {}) {
  const database = await openSqlite({ filename: ':memory:' }); handles.push(database)
  await migrate(database, [...authMigrations, ...sqlitePasswordResetMigrations])
  let time = 1_000_000
  const clock = () => time, store = new SqliteAuthStore(database), sent: PasswordResetDelivery[] = []
  const auth = new AuthService(store, passwords, { clock, passwordChanges: true })
  const resets = new PasswordResets(store, new SqlitePasswordResetStore(database), passwords, { clock, ...(options.requestLimit ? { requestLimit: options.requestLimit } : {}),
    deliver: delivery => { if (options.failDelivery) throw new Error('delivery failed'); sent.push(delivery) } })
  await auth.register('alice', current)
  const rows = async () => (await database.execute('SELECT * FROM longhorn_auth_password_resets')).rows
  return { database, store, auth, resets, sent, rows, advance: (ms: number) => { time += ms } }
}

it('delivers a token that replaces the password, revokes every session and works once', async () => {
  const { auth, resets, sent, rows } = await setup()
  const session = (await auth.login('alice', current)).session
  await resets.request('Alice')
  expect(sent).toHaveLength(1); expect(sent[0]!.user.username).toBe('alice'); expect(sent[0]!.token).toMatch(/^[a-f0-9]{64}$/)
  await resets.confirm(sent[0]!.token, next)
  expect(await auth.authenticate(session.token)).toBeUndefined()
  await expect(auth.login('alice', current)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect((await auth.login('alice', next)).user.username).toBe('alice')
  expect(await rows()).toEqual([])
  await expect(resets.confirm(sent[0]!.token, third)).rejects.toBeInstanceOf(PasswordResetError)
  expect((await auth.login('alice', next)).user.username).toBe('alice')
})
it('stores only a hash of the token', async () => {
  const { resets, sent, rows } = await setup()
  await resets.request('alice')
  const row = (await rows())[0]!
  expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/)
  expect(row.token_hash).not.toBe(sent[0]!.token)
  expect(Object.values(row).map(String)).not.toContain(sent[0]!.token)
})
it('behaves the same for unknown and invalid accounts, and sends nothing', async () => {
  const { resets, sent, rows } = await setup()
  await expect(resets.request('nobody')).resolves.toBeUndefined()
  await expect(resets.request('not a valid name!')).resolves.toBeUndefined()
  expect(sent).toEqual([]); expect(await rows()).toEqual([])
})
it('rejects an expired token and spends it', async () => {
  const { auth, resets, sent, rows, advance } = await setup()
  await resets.request('alice'); advance(30 * 60 * 1000)
  await expect(resets.confirm(sent[0]!.token, next)).rejects.toBeInstanceOf(PasswordResetError)
  expect(await rows()).toEqual([])
  expect((await auth.login('alice', current)).user.username).toBe('alice')
})
it('accepts a token just before it expires', async () => {
  const { auth, resets, sent, advance } = await setup()
  await resets.request('alice'); advance(30 * 60 * 1000 - 1)
  await resets.confirm(sent[0]!.token, next)
  expect((await auth.login('alice', next)).user.username).toBe('alice')
})
it('a new request replaces the earlier token', async () => {
  const { resets, sent, auth } = await setup()
  await resets.request('alice'); await resets.request('alice')
  await expect(resets.confirm(sent[0]!.token, next)).rejects.toBeInstanceOf(PasswordResetError)
  await resets.confirm(sent[1]!.token, next)
  expect((await auth.login('alice', next)).user.username).toBe('alice')
})
it('a password changed after issue kills the token', async () => {
  const { auth, resets, sent, rows } = await setup()
  const session = (await auth.login('alice', current)).session
  await resets.request('alice')
  await auth.changePassword(session.token, current, next)
  await expect(resets.confirm(sent[0]!.token, third)).rejects.toBeInstanceOf(PasswordResetError)
  expect(await rows()).toEqual([])
  expect((await auth.login('alice', next)).user.username).toBe('alice')
})
it('applies the password policy, and a weak password does not spend the token', async () => {
  const { resets, sent, rows } = await setup()
  await resets.request('alice')
  await expect(resets.confirm(sent[0]!.token, 'short')).rejects.toBeInstanceOf(AuthError)
  expect(await rows()).toHaveLength(1)
  await resets.confirm(sent[0]!.token, next)
})
it('rejects malformed and unknown tokens', async () => {
  const { resets } = await setup()
  await expect(resets.confirm('nope', next)).rejects.toBeInstanceOf(PasswordResetError)
  await expect(resets.confirm('f'.repeat(64), next)).rejects.toBeInstanceOf(PasswordResetError)
})
it('throttles requests per account without saying so, and keeps the outstanding token', async () => {
  const { resets, sent, advance } = await setup({ requestLimit: 2 })
  for (let i = 0; i < 5; i++) await resets.request('alice')
  expect(sent).toHaveLength(2)
  await resets.confirm(sent[1]!.token, next)
  advance(60 * 60 * 1000)
  await resets.request('alice')
  expect(sent).toHaveLength(3)
})
it('lifts a login lockout, because the user has proven control', async () => {
  const { auth, resets, sent } = await setup()
  for (let i = 0; i < 10; i++) await auth.login('alice', 'wrong passphrase value').catch(() => {})
  await expect(auth.login('alice', current)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  await resets.request('alice'); await resets.confirm(sent[0]!.token, next)
  expect((await auth.login('alice', next)).user.username).toBe('alice')
})
it('surfaces a delivery failure to the caller', async () => {
  const { resets } = await setup({ failDelivery: true })
  await expect(resets.request('alice')).rejects.toThrow('delivery failed')
})
it('prunes expired tokens and removes them with their user', async () => {
  const { database, resets, rows, advance } = await setup()
  await resets.request('alice')
  expect(await resets.prune()).toBe(0); advance(30 * 60 * 1000)
  expect(await resets.prune()).toBe(1); expect(await rows()).toEqual([])
  advance(60 * 60 * 1000); await resets.request('alice'); expect(await rows()).toHaveLength(1)
  await database.execute("DELETE FROM longhorn_auth_users WHERE username='alice'")
  expect(await rows()).toEqual([])
})
it('rejects unsafe configuration', async () => {
  const { store, database } = await setup(), reset = new SqlitePasswordResetStore(database)
  expect(() => new PasswordResets(store, reset, passwords, {} as never)).toThrow('delivery function')
  expect(() => new PasswordResets(store, reset, passwords, { deliver() {}, ttlMs: 1 })).toThrow('lifetime')
  expect(() => new PasswordResets(store, reset, passwords, { deliver() {}, requestLimit: 0 })).toThrow('throttle')
})
