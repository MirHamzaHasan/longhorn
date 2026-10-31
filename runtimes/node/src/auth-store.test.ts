import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@longhornjs/auth'
import { authMigrations, SqliteAuthStore } from '@longhornjs/auth/sqlite'
import { migrate } from '@longhornjs/database'
import type { Database } from '@longhornjs/database'
import { openSqlite } from './sqlite.js'

let temporary: string
let connections: Database[]
beforeEach(async () => { temporary = await mkdtemp(join(tmpdir(), 'longhorn-auth-store-')); connections = [] })
afterEach(async () => { await Promise.all(connections.map((connection) => connection.close())); await rm(temporary, { recursive: true, force: true }) })
async function open() {
  const database = await openSqlite({ filename: join(temporary, 'auth.sqlite') })
  connections.push(database)
  await migrate(database, authMigrations)
  return { database, store: new SqliteAuthStore(database) }
}
const hasher = { hash: async () => 'encoded-password-fixture', verify: async () => true }

it('persists accounts/sessions across connections and shares revocation without caches', async () => {
  const first = await open()
  const service = new AuthService(first.store, hasher)
  const user = await service.register('person', 'a long passphrase here')
  const login = await service.login('person', 'a long passphrase here')
  const rows = (await first.database.execute('SELECT * FROM longhorn_auth_sessions')).rows
  expect(rows[0]?.token_hash).not.toBe(login.session.token)
  const second = await open()
  const another = new AuthService(second.store, hasher)
  expect((await another.authenticate(login.session.token))?.user).toEqual(user)
  await another.logout(login.session.token)
  expect(await service.authenticate(login.session.token)).toBeUndefined()
  expect((await second.database.execute('SELECT count(*) AS count FROM longhorn_migrations')).rows[0]?.count).toBe(1n)
})

it('uses username uniqueness, live roles, and foreign-key cascade boundaries', async () => {
  const { store, database } = await open()
  const auth = new AuthService(store, hasher)
  const user = await auth.register('person', 'a long passphrase here')
  const { session } = await auth.login('person', 'a long passphrase here')
  await expect(auth.register('person', 'a long passphrase here')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
  await database.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["admin"]', user.id] })
  expect((await auth.authenticate(session.token))?.user.roles).toEqual(['admin'])
  await database.execute({ sql: 'DELETE FROM longhorn_auth_users WHERE id = ?', args: [user.id] })
  expect(await auth.authenticate(session.token)).toBeUndefined()
  expect((await database.execute('SELECT count(*) AS count FROM longhorn_auth_sessions')).rows[0]?.count).toBe(0n)
})

it('rotates atomically and preserves an old session if a replacement fails', async () => {
  const { store } = await open()
  const auth = new AuthService(store, hasher)
  await auth.register('person', 'a long passphrase here')
  const { session } = await auth.login('person', 'a long passphrase here')
  const old = (await open()).store
  const record = [...(await connections[0]!.execute('SELECT token_hash FROM longhorn_auth_sessions')).rows][0]!
  await expect(store.createSession({ tokenHash: 'b'.repeat(64), userId: 'absent-user', expiresAt: Date.now() + 10000 }, String(record.token_hash))).rejects.toThrow()
  expect(await old.findSession(String(record.token_hash))).toBeDefined()
  const next = await auth.login('person', 'a long passphrase here', session.token)
  expect(await auth.authenticate(session.token)).toBeUndefined()
  expect(await auth.authenticate(next.session.token)).toBeDefined()
})

it('reserves concurrent login attempts across handles and resets at the exact window boundary', async () => {
  const first = await open()
  const second = await open()
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    (index % 2 ? first.store : second.store).consumeLoginAttempt('key', 1000, 3, 1000)))
  expect(results.filter((value) => value === undefined)).toHaveLength(3)
  expect(results.filter((value) => value === 2000)).toHaveLength(9)
  expect(await second.store.consumeLoginAttempt('key', 2000, 3, 1000)).toBeUndefined()
  await first.store.clearLoginAttempts('key')
  expect(await second.store.consumeLoginAttempt('key', 2001, 3, 1000)).toBeUndefined()
})
