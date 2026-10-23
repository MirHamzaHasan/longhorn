import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Database, SqlExecutor } from '@longhorn/database'
import { migrate } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Idempotency, IdempotencyConflictError } from '@longhorn/idempotency'
import { SqliteIdempotencyStore, idempotencyMigrations } from '@longhorn/idempotency/sqlite'
import { Queue } from '@longhorn/queue'
import { SqliteQueueStore, queueMigrations } from '@longhorn/queue/sqlite'
import { enqueueInTransaction } from '@longhorn/queue/transaction'
import { z } from 'zod'

let database: Database, queue: Queue<{ id: string }>, service: Idempotency, now: number
const request = { scope: 'tenant:42:tasks:v1', key: 'request-1', input: { title: 'saved' } }
beforeEach(async () => {
  database = await openSqlite({ filename: ':memory:' }); now = 1000
  await migrate(database, [...queueMigrations, ...idempotencyMigrations, { id: 'idempotent_test/001', statements: ['CREATE TABLE business(id TEXT PRIMARY KEY,title TEXT NOT NULL) STRICT'] }])
  queue = new Queue({ name: 'idempotent.tasks.v1', schema: z.object({ id: z.string().min(1) }), store: new SqliteQueueStore(database) })
  service = new Idempotency({ store: new SqliteIdempotencyStore(database), retentionMs: 100, now: () => now })
})
afterEach(async () => { await queue.close(); await database.close() })
async function create(tx: SqlExecutor) {
  const id = crypto.randomUUID(); await tx.execute({ sql: 'INSERT INTO business VALUES(?,?)', args: [id, 'saved'] })
  const job = await enqueueInTransaction(queue, tx, { id }); return { id, job }
}
async function count(table: string) { return Number((await database.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n) }
it('replays the original result with one business/job/record, even after the job advances', async () => {
  const first = await service.run(request, create)
  await queue.runOnce(async () => {})
  const second = await service.run(request, async () => { throw new Error('must not run again') })
  expect(second).toEqual({ ...first, replayed: true }); expect(second.value).toEqual(first.value)
  expect(first.value.job.state).toBe('pending'); expect((await queue.get(first.value.job.id))!.state).toBe('succeeded')
  for (const table of ['business', 'longhorn_queue_jobs', 'longhorn_idempotency_requests']) expect(await count(table)).toBe(1)
})
it('serializes competing callers, conflicts on changed input and scopes different intents independently', async () => {
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => service.run(request, create)))
  expect(outcomes.filter(value => !value.replayed)).toHaveLength(1); expect(new Set(outcomes.map(value => value.value.id)).size).toBe(1)
  await expect(service.run({ ...request, input: { title: 'different' } }, create)).rejects.toBeInstanceOf(IdempotencyConflictError)
  await service.run({ ...request, scope: 'tenant:43:tasks:v1' }, create)
  expect(await count('business')).toBe(2)
})
it('rolls back failed business work and invalid result snapshots, allowing a successful retry', async () => {
  const original = new Error('owned business error')
  await expect(service.run(request, async tx => { await create(tx); throw original })).rejects.toBe(original)
  await expect(service.run(request, async tx => { await create(tx); return { lossy: undefined } as never })).rejects.toThrow('JSON')
  for (const table of ['business', 'longhorn_queue_jobs', 'longhorn_idempotency_requests']) expect(await count(table)).toBe(0)
  expect((await service.run(request, create)).replayed).toBe(false)
})
it('joins accepted publishers and rolls back a caught publish failure with the saved response', async () => {
  await expect(service.run(request, async tx => {
    const result = await create(tx)
    await enqueueInTransaction(queue, tx, { id: '' }).catch(() => {})
    return result
  })).rejects.toMatchObject({ name: 'ValidationError' })
  expect(await count('business')).toBe(0); expect(await count('longhorn_idempotency_requests')).toBe(0)
})
it('reuses expired keys at the boundary, starts retention at completion and prunes only bounded expired records', async () => {
  const first = await service.run(request, async tx => { const result = await create(tx); now = 1050; return result })
  expect(first.expiresAt).toBe(1150)
  now = 1149; expect((await service.run(request, create)).replayed).toBe(true)
  now = 1150
  await expect(service.run({ ...request, input: { title: 'new' } }, async tx => { await create(tx); throw new Error('failed replacement') })).rejects.toThrow('failed replacement')
  const replacement = await service.run({ ...request, input: { title: 'new' } }, create)
  expect(replacement.replayed).toBe(false); expect(replacement.value.id).not.toBe(first.value.id)
  await service.run({ ...request, key: 'second' }, create); await service.run({ ...request, key: 'third' }, create)
  expect(await service.prune(1)).toBe(0); now = 1250
  expect(await service.prune(2)).toBe(2); expect(await count('longhorn_idempotency_requests')).toBe(1)
  expect(await service.prune()).toBe(1); expect(await count('business')).toBe(4)
})
it('rolls back unsafe clocks, oversized responses and rejects incompatible providers', async () => {
  const invalid = new Idempotency({ store: new SqliteIdempotencyStore(database), now: () => NaN })
  await expect(invalid.run(request, create)).rejects.toThrow('clock')
  const small = new Idempotency({ store: new SqliteIdempotencyStore(database), maxResultBytes: 2 })
  await expect(small.run(request, create)).rejects.toThrow('byte limit')
  expect(await count('business')).toBe(0); expect(await count('longhorn_idempotency_requests')).toBe(0)
  expect(() => new SqliteIdempotencyStore({ ...database, dialect: 'postgres' })).toThrow('sqlite database')
})
