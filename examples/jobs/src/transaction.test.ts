import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrate } from '@longhorn/database'
import type { Database, SqlExecutor } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Queue } from '@longhorn/queue'
import { MemoryQueueStore } from '@longhorn/queue/memory'
import { SqliteQueueStore, queueMigrations } from '@longhorn/queue/sqlite'
import { enqueueInTransaction } from '@longhorn/queue/transaction'
import type { StandardSchemaV1 } from '@longhorn/validation'
import { z } from 'zod'

const schema = z.object({ businessId: z.string().min(1) }).strict()
let database: Database, queue: Queue<{ businessId: string }>
beforeEach(async () => {
  database = await openSqlite({ filename: ':memory:' })
  await migrate(database, [...queueMigrations, { id: 'atomic_test/001', statements: ['CREATE TABLE business (id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT'] }])
  queue = new Queue({ name: 'atomic.v1', schema, store: new SqliteQueueStore(database) })
})
afterEach(async () => { await queue?.close(); await database?.close() })
const count = async (table: string) => Number((await database.execute('SELECT count(*) AS count FROM '+table)).rows[0]!.count)
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }

it('commits a business row and validated job together and consumes against that committed row', async () => {
  const result = await database.transaction(async tx => {
    await tx.execute("INSERT INTO business VALUES('one','saved')")
    const job = await enqueueInTransaction(queue, tx, { businessId: 'one' }, { delayMs: 0, maxAttempts: 2 })
    return { value: 42, job }
  })
  expect(result.value).toBe(42); expect(result.job.maxAttempts).toBe(2); expect(await count('business')).toBe(1)
  expect((await queue.runOnce(async input => {
    expect((await database.execute({ sql: 'SELECT value FROM business WHERE id=?', args: [input.businessId] })).rows[0]!.value).toBe('saved')
  })).status).toBe('succeeded')
})
it('rolls back the job and business write if later business work throws', async () => {
  const original = { domain: 'failure' }; let jobId = ''
  await expect(database.transaction(async tx => {
    await tx.execute("INSERT INTO business VALUES('rollback','value')")
    jobId = (await enqueueInTransaction(queue, tx, { businessId: 'rollback' })).id
    throw original
  })).rejects.toBe(original)
  expect(await count('business')).toBe(0); expect(await queue.get(jobId)).toBeUndefined()
})
it('waits for an unawaited asynchronous publisher and queue close before committing', async () => {
  const entered = deferred(), release = deferred()
  const asynchronous: StandardSchemaV1<unknown, { businessId: string }> = { '~standard': { version: 1, vendor: 'atomic-test', async validate(input) { entered.resolve(); await release.promise; return schema['~standard'].validate(input) } } }
  const slow = new Queue({ name: 'slow.v1', schema: asynchronous, store: new SqliteQueueStore(database) })
  let retained!: SqlExecutor
  const transaction = database.transaction(async tx => {
    retained = tx; await tx.execute("INSERT INTO business VALUES('slow','saved')")
    void enqueueInTransaction(slow, tx, { businessId: 'slow' })
    return 42
  })
  await entered.promise; const closing = slow.close(); let closed = false, committed = false
  closing.then(() => { closed = true }); transaction.then(() => { committed = true }); await Promise.resolve()
  expect(closed).toBe(false); expect(committed).toBe(false)
  await expect(retained.execute('SELECT 1')).rejects.toThrow('closed')
  release.resolve(); expect(await transaction).toBe(42); await closing
  expect(await count('business')).toBe(1); expect(await count('longhorn_queue_jobs')).toBe(1)
})
it('rejects commit after a caught invalid publication and leaves no business row', async () => {
  await expect(database.transaction(async tx => {
    await tx.execute("INSERT INTO business VALUES('invalid','must rollback')")
    await enqueueInTransaction(queue, tx, { businessId: '' }).catch(() => {})
  })).rejects.toMatchObject({ name: 'ValidationError' })
  expect(await count('business')).toBe(0); expect(await count('longhorn_queue_jobs')).toBe(0)
})
it('rejects root, cloned, expired, and foreign-database executors without separate commits', async () => {
  await expect(enqueueInTransaction(queue, database, { businessId: 'root' })).rejects.toThrow('active managed')
  let retained!: SqlExecutor
  await database.transaction(async tx => { retained = tx; await expect(enqueueInTransaction(queue, { ...tx }, { businessId: 'clone' })).rejects.toThrow('active managed') })
  await expect(enqueueInTransaction(queue, retained, { businessId: 'expired' })).rejects.toThrow('active managed')
  const other = await openSqlite({ filename: ':memory:' }), foreign = new Queue({ name: 'foreign.v1', schema, store: new SqliteQueueStore(other) })
  try {
    await expect(database.transaction(async tx => {
      await tx.execute("INSERT INTO business VALUES('foreign','must rollback')")
      await enqueueInTransaction(foreign, tx, { businessId: 'foreign' })
    })).rejects.toMatchObject({ name: 'QueueStoreError', cause: expect.objectContaining({ message: 'Transaction belongs to a different database' }) })
    expect(await count('business')).toBe(0); expect(await count('longhorn_queue_jobs')).toBe(0)
  } finally { await foreign.close(); await other.close() }
})
it('rolls back declared publications rejected by unsupported or closed queues', async () => {
  const memory = new Queue({ name: 'memory.v1', schema, store: new MemoryQueueStore() })
  try {
    await expect(database.transaction(async tx => {
      await tx.execute("INSERT INTO business VALUES('unsupported','value')")
      await enqueueInTransaction(memory, tx, { businessId: 'unsupported' }).catch(() => {})
    })).rejects.toThrow('does not support')
  } finally { await memory.close() }
  await queue.close()
  await expect(database.transaction(async tx => {
    await tx.execute("INSERT INTO business VALUES('closed','value')")
    await enqueueInTransaction(queue, tx, { businessId: 'closed' })
  })).rejects.toMatchObject({ name: 'QueueClosedError' })
  expect(await count('business')).toBe(0)
})
