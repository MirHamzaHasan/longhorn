import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Outbox } from '@longhorn/outbox'
import { SqliteOutboxStore, outboxMigrations } from '@longhorn/outbox/sqlite'
import { queueMigrations } from '@longhorn/queue/sqlite'
import { z } from 'zod'
let database: Database, outbox: Outbox<{ id: string }>, now: number
beforeEach(async () => {
  database = await openSqlite({ filename: ':memory:' }); now = 1000
  await migrate(database, [...queueMigrations, ...outboxMigrations, { id: 'outbox_test/001', statements: ['CREATE TABLE business(id TEXT PRIMARY KEY) STRICT'] }])
  outbox = new Outbox({ name: 'events.v1', schema: z.object({ id: z.string().min(1) }), store: new SqliteOutboxStore(database), now: () => now, leaseMs: 100, retryDelayMs: 10 })
})
afterEach(async () => { await outbox.close(); await database.close() })
it('commits the outgoing record with business state and publishes its stable identity after commit', async () => {
  const info = await database.transaction(async tx => { await tx.execute("INSERT INTO business VALUES('one')"); return outbox.enqueueInTransaction(tx, { id: 'one' }) })
  expect(outbox.queueName).toBe('outbox.events.v1')
  const messages: unknown[] = []
  expect((await outbox.dispatchOnce({ async publish(message, context) {
    expect((await database.execute('SELECT id FROM business')).rows).toHaveLength(1)
    expect(context.signal.aborted).toBe(false); messages.push(message)
  } })).status).toBe('succeeded')
  expect(messages).toEqual([{ id: info.id, topic: 'events.v1', data: { id: 'one' } }])
  expect((await outbox.get(info.id))!.state).toBe('succeeded')
})
it('rolls back business/outgoing work on later failure and caught validation failure', async () => {
  await expect(database.transaction(async tx => { await tx.execute("INSERT INTO business VALUES('bad')"); await outbox.enqueueInTransaction(tx, { id: 'bad' }); throw new Error('later') })).rejects.toThrow('later')
  await expect(database.transaction(async tx => { await tx.execute("INSERT INTO business VALUES('invalid')"); await outbox.enqueueInTransaction(tx, { id: '' }).catch(() => {}) })).rejects.toMatchObject({ name: 'ValidationError' })
  expect((await database.execute('SELECT * FROM business')).rows).toHaveLength(0)
  expect((await outbox.dispatchOnce({ async publish() { throw new Error('unexpected publish') } })).status).toBe('idle')
})
it('retries ambiguous remote acceptance with the same message ID and bounded attempts/backoff', async () => {
  const info = await outbox.enqueue({ id: 'remote' }, { maxAttempts: 2 }), ids: string[] = []
  const publisher = { async publish(message: { id: string }) { ids.push(message.id); if (ids.length === 1) throw new Error('accepted but response lost') } }
  expect((await outbox.dispatchOnce(publisher)).status).toBe('retrying')
  expect((await outbox.dispatchOnce(publisher)).status).toBe('idle'); now += 10
  expect((await outbox.dispatchOnce(publisher)).status).toBe('succeeded'); expect(ids).toEqual([info.id, info.id])
  const terminal = await outbox.enqueue({ id: 'failed' }, { maxAttempts: 1 })
  expect((await outbox.dispatchOnce({ async publish() { throw new Error('unavailable') } })).status).toBe('failed')
  expect((await outbox.get(terminal.id))!.state).toBe('failed')
})
it('retains real publisher ownership during dispatcher and outbox close', async () => {
  await outbox.enqueue({ id: 'held' })
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const dispatcher = outbox.createDispatcher({ async publish() { entered(); await gate } }, { pollIntervalMs: 1 })
  dispatcher.start(); await started
  let closed = false
  const closing = Promise.all([dispatcher.close(), outbox.close()]).then(() => { closed = true })
  try { expect(closed).toBe(false); expect(dispatcher.snapshot().active).toBe(1) } finally { release() }
  await closing; expect(closed).toBe(true); expect(dispatcher.snapshot().state).toBe('closed')
  await expect(outbox.enqueue({ id: 'late' })).rejects.toMatchObject({ name: 'QueueClosedError' })
  await expect(outbox.prune({ before: now })).rejects.toThrow('closing or closed')
})
it('prunes only bounded terminal rows of this outbox and retains failed rows unless requested', async () => {
  const other = new Outbox({ name: 'other.v1', schema: z.object({ id: z.string() }), store: new SqliteOutboxStore(database), now: () => now })
  try {
    const otherInfo = await other.enqueue({ id: 'other' }); await other.dispatchOnce({ async publish() {} })
    const a = await outbox.enqueue({ id: 'a' }), b = await outbox.enqueue({ id: 'b' }), failed = await outbox.enqueue({ id: 'failed' }, { maxAttempts: 1 })
    for (let i = 0; i < 3; i++) await outbox.dispatchOnce({ async publish(data) { if (data.data.id === 'failed') throw new Error('failed') } })
    const pending = await outbox.enqueue({ id: 'pending' })
    expect(await outbox.prune({ before: now-1 })).toBe(0)
    expect(await outbox.prune({ before: now, limit: 1 })).toBe(1); expect(await outbox.prune({ before: now, limit: 1 })).toBe(1)
    expect(await outbox.get(a.id)).toBeUndefined(); expect(await outbox.get(b.id)).toBeUndefined()
    expect(await outbox.get(failed.id)).toBeDefined(); expect(await outbox.prune({ before: now, includeFailed: true })).toBe(1)
    expect(await outbox.get(pending.id)).toBeDefined(); expect(await other.get(otherInfo.id)).toBeDefined()
  } finally { await other.close() }
})
it('rejects unsafe scopes, bad configuration and invalid pruning bounds before changing records', async () => {
  await expect(outbox.enqueueInTransaction(database, { id: 'root' })).rejects.toThrow('managed transaction')
  await expect(outbox.prune({ before: now, limit: 0 })).rejects.toThrow('prune limit')
  expect(() => new Outbox({ name: 'x'.repeat(94), schema: z.object({ id: z.string() }), store: new SqliteOutboxStore(database) })).toThrow('name')
  expect(() => new SqliteOutboxStore({ ...database, dialect: 'postgres' })).toThrow('SQLite database')
})
it('joins an admitted maintenance operation before close and rejects later pruning', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  class HeldStore extends SqliteOutboxStore {
    override async prune(...args: Parameters<SqliteOutboxStore['prune']>) { entered(); await gate; return super.prune(...args) }
  }
  const maintained = new Outbox({ name: 'maintenance.v1', schema: z.object({ id: z.string() }), store: new HeldStore(database) })
  const operation = maintained.prune({ before: now })
  await started
  let closed = false; const closing = maintained.close().then(() => { closed = true })
  try { expect(closed).toBe(false); await expect(maintained.prune({ before: now })).rejects.toThrow('closing or closed') }
  finally { release(); await closing }
  expect(await operation).toBe(0); expect(closed).toBe(true)
})
