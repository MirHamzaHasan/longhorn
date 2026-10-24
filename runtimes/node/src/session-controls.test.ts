import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqlite } from './sqlite.js'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { authMigrations, SqliteAuthStore } from '@longhorn/auth/sqlite'
import { SqliteSessionControlStore } from '@longhorn/auth/sqlite-session-controls'
const current = 'a'.repeat(64), other = 'b'.repeat(64), peer = 'c'.repeat(64), expired = 'd'.repeat(64)
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function seed(database: Database) {
  await migrate(database, authMigrations); const store = new SqliteAuthStore(database)
  for (const name of ['alice', 'bob']) await store.createUser({ id: name, username: name, roles: ['member'], passwordHash: 'original' })
  for (const [tokenHash,userId,expiresAt] of [[current,'alice',2000],[other,'alice',2000],[peer,'bob',2000],[expired,'alice',1000]] as const) await store.createSession({ tokenHash, userId, expiresAt })
  return store
}
it('revokes only live subject sessions, preserves current/peer credentials and supports all/zero-other scopes', async () => {
  const db = await openSqlite({ filename: ':memory:' })
  try {
    const store = await seed(db)
    expect(await store.sessionControls.revoke({ tokenHash: current, scope: 'others' }, () => 1000)).toBe(1)
    expect(await store.findSession(current)).toBeDefined(); expect(await store.findSession(other)).toBeUndefined(); expect(await store.findSession(peer)).toBeDefined(); expect(await store.findSession(expired)).toBeDefined()
    expect(await store.sessionControls.revoke({ tokenHash: current, scope: 'others' }, () => 1000)).toBe(0)
    expect(await store.sessionControls.revoke({ tokenHash: current, scope: 'all' }, () => 1000)).toBe(1)
    expect(await store.findSession(current)).toBeUndefined(); expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('original')
    expect(await store.sessionControls.revoke({ tokenHash: current, scope: 'all' }, () => 1000)).toBeUndefined()
  } finally { await db.close() }
})
it('rolls back session deletion on an actual SQL trigger failure', async () => {
  const db = await openSqlite({ filename: ':memory:' })
  try {
    const store = await seed(db)
    await db.execute("CREATE TRIGGER reject_session_control BEFORE DELETE ON longhorn_auth_sessions BEGIN SELECT RAISE(ABORT,'fixture session rollback'); END")
    await expect(store.sessionControls.revoke({ tokenHash: current, scope: 'all' }, () => 1000)).rejects.toThrow('fixture session rollback')
    for (const hash of [current,other,peer]) expect(await store.findSession(hash)).toBeDefined()
  } finally { await db.close() }
})
it('copies caller input before admission and rejects malformed input/clock without deletion', async () => {
  const db = await openSqlite({ filename: ':memory:' }), entered = deferred(), release = deferred()
  try {
    const store = await seed(db), delayed: Database = { dialect: 'sqlite', execute: db.execute.bind(db), close: async () => {}, transaction: async work => { entered.resolve(); await release.promise; return db.transaction(work) } }
    const input = { tokenHash: current, scope: 'others' as const }, port = new SqliteSessionControlStore(delayed)
    const pending = port.revoke(input, () => 1000); await entered.promise; input.tokenHash = peer; release.resolve(); expect(await pending).toBe(1)
    expect(await store.findSession(current)).toBeDefined(); expect(await store.findSession(peer)).toBeDefined()
    await expect(store.sessionControls.revoke({ tokenHash: '', scope: 'all' }, () => 1000)).rejects.toThrow('Invalid session control input')
    await expect(store.sessionControls.revoke({ tokenHash: current, scope: 'all' }, () => -1)).rejects.toThrow('timestamp')
    expect(await store.findSession(current)).toBeDefined()
  } finally { release.resolve(); await db.close() }
})
it('checks expiry after actual same-file ownership and rejects a caller removed while waiting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-session-controls-')), filename = join(directory, 'auth.sqlite')
  const first = await openSqlite({ filename }), second = await openSqlite({ filename }), entered = deferred(), release = deferred()
  let holder: Promise<void> | undefined, now = 1000, samples = 0
  try {
    const store = await seed(first)
    holder = first.transaction(async () => { entered.resolve(); await release.promise }); await entered.promise
    const pending = new SqliteSessionControlStore(second).revoke({ tokenHash: current, scope: 'all' }, () => { samples++; return now })
    await Promise.resolve(); expect(samples).toBe(0); now = 2000; release.resolve(); await holder
    expect(await pending).toBeUndefined(); expect(samples).toBe(1)
    expect(await store.findSession(current)).toBeDefined(); expect(await store.findSession(other)).toBeDefined()
    await store.deleteSession(current)
    expect(await new SqliteSessionControlStore(second).revoke({ tokenHash: current, scope: 'all' }, () => 1000)).toBeUndefined()
    expect(await store.findSession(other)).toBeDefined()
  } finally { release.resolve(); await holder; await first.close(); await second.close(); await rm(directory,{recursive:true,force:true}) }
})
