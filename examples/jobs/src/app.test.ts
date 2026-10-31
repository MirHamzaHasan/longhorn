import { afterEach, expect, it } from 'vitest'
import { openSqlite } from '@longhornjs/node/sqlite'
import { createLogger } from '@longhornjs/logger'
import { migrate } from '@longhornjs/database'
import { queueMigrations } from '@longhornjs/queue/sqlite'
import type { Longhorn } from '@longhornjs/core'
import { createJobsApp, ReportQueue, ReportScheduler } from './app.js'
import { configSchema } from './config.js'
import { reportHandler, reportMigrations } from './reports.js'

const applications: Longhorn[] = []
afterEach(async () => { await Promise.all(applications.map((app) => app.close())); applications.length = 0 })
async function setup(workerEnabled = false, schedulerEnabled = false) {
  const database = await openSqlite({ filename: ':memory:' })
  const app = createJobsApp(configSchema.parse({ WORKER_ENABLED: String(workerEnabled), SCHEDULER_ENABLED: String(schedulerEnabled) }), {
    openDatabase: async () => database, logger: createLogger({ level: 'silent' }),
  })
  applications.push(app)
  const request = (path: string, body?: unknown) => app.fetch(new Request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }))
  return { app, database, request }
}
it('enqueues validated report jobs, exposes status and stores idempotent results', async () => {
  const { app, database, request } = await setup()
  const response = await request('/reports', { numbers: [2, 4, 6] })
  expect(response.status).toBe(202)
  const { job } = await response.json()
  expect(response.headers.get('Location')).toBe(`/reports/${job.id}`)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(job).toMatchObject({ state: 'pending', attempts: 0 })
  expect(job).not.toHaveProperty('payload'); expect(job).not.toHaveProperty('leaseToken')
  expect((await (await request(`/reports/${job.id}`)).json()).report).toBeNull()
  const handler = reportHandler(database)
  expect((await app.container.resolve(ReportQueue).runOnce(handler)).status).toBe('succeeded')
  const result = await (await request(`/reports/${job.id}`)).json()
  expect(result.job.state).toBe('succeeded')
  expect(result.report).toEqual({ count: 3, sum: 12, min: 2, max: 6 })
  await handler({ numbers: [99] }, { id: job.id, queue: job.queue, attempt: 2, maxAttempts: 3, signal: new AbortController().signal })
  expect((await (await request(`/reports/${job.id}`)).json()).report).toEqual(result.report)
  await app.close()
  await expect(database.execute('SELECT 1')).rejects.toThrow('closed')
})
it('rejects malformed, oversized and unknown reports', async () => {
  const { request } = await setup()
  for (const body of [{ numbers: [] }, { numbers: ['x'] }, { numbers: [1], admin: true }, { numbers: [1e14] }]) {
    expect((await request('/reports', body)).status).toBe(400)
  }
  expect((await request('/reports', { numbers: Array.from({ length: 50_000 }, () => 1) })).status).toBe(413)
  expect((await request('/reports/missing')).status).toBe(404)
})
it('processes accepted jobs through the lifecycle-owned polling worker', async () => {
  const { request } = await setup(true)
  const { job } = await (await request('/reports', { numbers: [3, 7] })).json()
  const deadline = Date.now() + 2000
  while (true) {
    const status = await (await request(`/reports/${job.id}`)).json()
    if (status.job.state === 'succeeded') { expect(status.report.sum).toBe(10); break }
    if (Date.now() >= deadline) throw new Error('Worker did not process report')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
})
it('registers durable schedules idempotently, dispatches reports and cancels future occurrences', async () => {
  const { app, database, request } = await setup()
  const body = { id: 'hourly-report', numbers: [2, 4], schedule: { kind: 'interval', intervalMs: 1000, startAt: 1000 } }
  const response = await request('/report-schedules', body)
  expect(response.status).toBe(200)
  expect(response.headers.get('Location')).toBe('/report-schedules/hourly-report')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const { schedule } = await response.json()
  expect(schedule).not.toHaveProperty('payload')
  expect((await (await request('/report-schedules', body)).json()).schedule).toEqual(schedule)
  expect((await request('/report-schedules', { ...body, numbers: [99] })).status).toBe(409)
  await app.container.resolve(ReportScheduler).tick()
  const status = await (await request('/report-schedules/hourly-report')).json()
  expect(status.schedule.dispatchCount).toBe(1)
  await app.container.resolve(ReportQueue).runOnce(reportHandler(database))
  expect((await (await request(`/reports/${status.schedule.lastJobId}`)).json()).report.sum).toBe(6)
  expect((await app.fetch(new Request('http://localhost/report-schedules/hourly-report', { method: 'DELETE' }))).status).toBe(204)
  expect((await app.container.resolve(ReportScheduler).tick()).dispatched).toEqual([])
  expect((await request('/report-schedules/missing')).status).toBe(404)
})
it('rejects invalid schedule definitions and appends migrations after the existing deployed report prefix', async () => {
  const { app, database, request } = await setup()
  await migrate(database, [...queueMigrations, ...reportMigrations])
  await database.execute("INSERT INTO example_reports (job_id,result) VALUES ('existing','{\"sum\":12}')")
  for (const schedule of [{ kind: 'interval', intervalMs: 0 }, { kind: 'cron', expression: '@daily' }, { kind: 'cron', expression: '0 0 30 2 *' }, { kind: 'once', at: -1 }]) {
    expect((await request('/report-schedules', { numbers: [1], schedule })).status).toBe(400)
  }
  const migrations = (await database.execute('SELECT id FROM longhorn_migrations ORDER BY position')).rows.map((row) => row.id)
  expect(migrations).toEqual(['longhorn_queue/001_jobs', 'jobs_example/001_reports', 'longhorn_scheduler/001_schedules'])
  expect((await database.execute("SELECT result FROM example_reports WHERE job_id = 'existing'")).rows[0]?.result).toBe('{"sum":12}')
  await app.close()
})
it('runs scheduling and queue processing through lifecycle timers', async () => {
  const { request } = await setup(true, true)
  const response = await request('/report-schedules', { id: 'timer-report', numbers: [5, 10], schedule: { kind: 'once', at: Date.now() + 50 } })
  expect(response.status).toBe(200)
  const deadline = Date.now() + 2000
  while (true) {
    const { schedule } = await (await request('/report-schedules/timer-report')).json()
    if (schedule.lastJobId) {
      const result = await (await request(`/reports/${schedule.lastJobId}`)).json()
      if (result.job.state === 'succeeded') { expect(result.report.sum).toBe(15); break }
    }
    if (Date.now() >= deadline) throw new Error('Timed report was not processed')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
})
