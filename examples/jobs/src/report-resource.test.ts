import { expect, it } from 'vitest'
import { createJobsApp, ReportCompute, ReportDatabase, ReportQueue } from './app.js'
import { configSchema } from './config.js'
import { reportHandler } from './reports.js'
import { openSqlite } from '@longhorn/node/sqlite'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
it('acquires computation asynchronously and drains queue work before computation and database cleanup', async () => {
  const database = await openSqlite({ filename: ':memory:' }), entered = deferred(), release = deferred(), order: string[] = []
  let opened = 0
  const compute = async () => { entered.resolve(); await release.promise; return { count: 2, sum: 6, min: 2, max: 4 } }
  const app = createJobsApp(configSchema.parse({ WORKER_ENABLED: 'false', SCHEDULER_ENABLED: 'false' }), {
    openDatabase: async () => ({ execute: input => database.execute(input), transaction: work => database.transaction(work), close: async () => { order.push('database'); await database.close() } }),
    openReportComputer: async () => { opened++; return { compute, healthy: async () => true, close: async () => { order.push('computer') } } },
  })
  expect(opened).toBe(0)
  expect(() => app.container.resolve(ReportCompute)).toThrow('not ready')
  try {
    await app.start(); expect(opened).toBe(1)
    const queue = app.container.resolve(ReportQueue), connection = app.container.resolve(ReportDatabase)
    const job = await queue.enqueue({ numbers: [2, 4] })
    const running = queue.runOnce(reportHandler(connection, app.container.resolve(ReportCompute)))
    await entered.promise
    const closing = app.close()
    await new Promise(resolve => setTimeout(resolve, 0)); expect(order).toEqual([])
    release.resolve(); expect((await running).status).toBe('succeeded')
    await closing; expect(order).toEqual(['computer', 'database'])
    expect(job.id).toBeTruthy()
  } finally { release.resolve(); await app.close() }
})

it('rolls back the opened database when computation acquisition fails', async () => {
  const database = await openSqlite({ filename: ':memory:' }), failure = new Error('computation unavailable')
  const app = createJobsApp(configSchema.parse({ WORKER_ENABLED: 'false', SCHEDULER_ENABLED: 'false' }), {
    openDatabase: async () => database, openReportComputer: async () => { throw failure },
  })
  await expect(app.start()).rejects.toBe(failure)
  await expect(database.execute('SELECT 1')).rejects.toThrow('closed')
  await app.close()
})
