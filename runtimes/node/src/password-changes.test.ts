import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqlite } from './sqlite.js'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { authMigrations, SqliteAuthStore } from '@longhorn/auth/sqlite'
import { SqlitePasswordStore } from '@longhorn/auth/sqlite-passwords'

const token = 'a'.repeat(64), other = 'b'.repeat(64), key = 'c'.repeat(64)
const change = { userId: 'alice-id', tokenHash: token, expectedPasswordHash: 'old-encoded', nextPasswordHash: 'new-encoded', attemptKey: key }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function seed(database: Database) {
  await migrate(database, authMigrations)
  const store = new SqliteAuthStore(database)
  for (const name of ['alice', 'bob']) await store.createUser({ id: name + '-id', username: name, roles: ['member'], passwordHash: 'old-encoded' })
  await store.createSession({ tokenHash: token, userId: 'alice-id', expiresAt: 2000 })
  await store.createSession({ tokenHash: other, userId: 'bob-id', expiresAt: 2000 })
  await store.consumeLoginAttempt(key, 1000, 10, 1000)
  return store
}

it('rolls hash/revocation/attempt writes back on real SQL failure and preserves peer data on success', async () => {
  const database = await openSqlite({ filename: ':memory:' })
  try {
    const store = await seed(database)
    await database.execute("CREATE TRIGGER reject_password_delete BEFORE DELETE ON longhorn_auth_sessions BEGIN SELECT RAISE(ABORT,'fixture rollback'); END")
    await expect(store.passwordChanges.replacePassword(change, () => 1000)).rejects.toThrow('fixture rollback')
    expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('old-encoded')
    expect(await store.findSession(token)).toBeDefined(); expect(await store.findSession(other)).toBeDefined()
    expect((await database.execute('SELECT attempts FROM longhorn_auth_attempts')).rows[0]?.attempts).toBe(1n)
    await database.execute('DROP TRIGGER reject_password_delete')
    expect(await store.passwordChanges.replacePassword(change, () => 1000)).toBe(true)
    expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('new-encoded')
    expect(await store.findSession(token)).toBeUndefined(); expect(await store.findSession(other)).toBeDefined()
    expect((await database.execute('SELECT count(*) AS n FROM longhorn_auth_attempts')).rows[0]?.n).toBe(0n)
  } finally { await database.close() }
})

it('does not rotate previous sessions or clear attempts when conditional issuance fails or native insert rejects', async () => {
  const database = await openSqlite({ filename: ':memory:' })
  try {
    const store = await seed(database), session = { tokenHash: 'd'.repeat(64), userId: 'alice-id', expiresAt: 2000 }
    expect(await store.passwordChanges.createSession({ session, previousHash: token, expectedPasswordHash: 'obsolete', attemptKey: key })).toBe(false)
    expect(await store.findSession(token)).toBeDefined(); expect(await store.findSession(session.tokenHash)).toBeUndefined()
    await expect(store.passwordChanges.createSession({ session: { ...session, tokenHash: other }, previousHash: token, expectedPasswordHash: 'old-encoded', attemptKey: key })).rejects.toThrow()
    expect(await store.findSession(token)).toBeDefined()
    expect((await database.execute('SELECT attempts FROM longhorn_auth_attempts')).rows[0]?.attempts).toBe(1n)
    expect(await store.passwordChanges.createSession({ session, previousHash: token, expectedPasswordHash: 'old-encoded', attemptKey: key })).toBe(true)
    expect(await store.findSession(token)).toBeUndefined(); expect(await store.findSession(session.tokenHash)).toBeDefined()
  } finally { await database.close() }
})

it('snapshots caller-owned candidate input before transaction admission', async () => {
  const database = await openSqlite({ filename: ':memory:' }), entered = deferred(), release = deferred()
  try {
    const store = await seed(database)
    const delayed: Database = { dialect: 'sqlite', execute: database.execute.bind(database), close: async () => {}, transaction: async work => {
      entered.resolve(); await release.promise; return database.transaction(work)
    } }
    const port = new SqlitePasswordStore(delayed), input = { session: { tokenHash: 'd'.repeat(64), userId: 'alice-id', expiresAt: 2000 }, expectedPasswordHash: 'old-encoded', attemptKey: key }
    const pending = port.createSession(input); await entered.promise
    input.session.userId = 'bob-id'; input.session.tokenHash = 'e'.repeat(64); input.expectedPasswordHash = 'mutated'
    release.resolve(); expect(await pending).toBe(true)
    expect((await store.findSession('d'.repeat(64)))?.userId).toBe('alice-id')
    expect(await store.findSession('e'.repeat(64))).toBeUndefined()
  } finally { release.resolve(); await database.close() }
})

it('samples session expiry only after a real same-file transaction gate becomes available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-password-expiry-')), filename = join(directory, 'auth.sqlite')
  const first = await openSqlite({ filename }), second = await openSqlite({ filename }), entered = deferred(), release = deferred()
  let holder: Promise<void> | undefined
  try {
    const store = await seed(first); let now = 1000, calls = 0
    holder = first.transaction(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const pending = new SqlitePasswordStore(second).replacePassword(change, () => { calls++; return now })
    await Promise.resolve(); expect(calls).toBe(0)
    now = 2000; release.resolve(); await holder
    expect(await pending).toBe(false); expect(calls).toBe(1)
    expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('old-encoded')
    expect(await store.findSession(token)).toBeDefined()
  } finally { release.resolve(); await holder; await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }) }
})
