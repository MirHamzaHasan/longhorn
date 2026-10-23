import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Longhorn } from '@longhorn/core'
import { openPostgres } from '@longhorn/node/postgres'
import { createPostgresApp, PgDatabase } from './app.js'
import { TaskReportQueue,TaskReportScheduler } from './background.js'
import { taskReportHandler } from './reports.js'
if (process.env.LONGHORN_PG_TEST_OWNED !== 'true' || !process.env.LONGHORN_PG_APP_URL || !process.env.LONGHORN_PG_TEST_URL) throw new Error('Use pnpm test:postgres with its isolated database')
const applications: Longhorn[] = []
beforeEach(async () => {
  const owner = await openPostgres({ connectionString: process.env.LONGHORN_PG_TEST_URL! })
  try { await owner.execute('TRUNCATE longhorn_pg_example.tasks,longhorn_pg_example.task_reports,longhorn_queue.jobs,longhorn_scheduler.schedules RESTART IDENTITY') } finally { await owner.close() }
})
afterEach(async () => { for (const app of applications.splice(0)) await app.close() })
function setup() {
  const app = createPostgresApp({ openDatabase: () => openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL! }) })
  applications.push(app)
  const request = (path: string, method = 'GET', body?: unknown) => app.fetch(new Request('http://localhost' + path, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { app, request }
}
it('executes real CRUD through a restricted runtime role with stable cursor pages and boolean filters', async () => {
  const { request } = setup(), titles = ['one', 'two', "x'); DROP TABLE tasks; --"]
  const tasks = []
  for (const title of titles) {
    const response = await request('/tasks', 'POST', { title })
    expect(response.status).toBe(201)
    const { task } = await response.json(); tasks.push(task)
    expect(response.headers.get('Location')).toBe('/tasks/' + task.id)
    expect(typeof task.id).toBe('string')
  }
  const page = await (await request('/tasks?limit=2')).json()
  expect(page.tasks.map((task: { title: string }) => task.title)).toEqual(['one', 'two'])
  expect(page.nextCursor).toBe('2')
  const next = await (await request('/tasks?limit=2&after=' + page.nextCursor)).json()
  expect(next.tasks[0].title).toBe(titles[2]); expect(next.nextCursor).toBeNull()
  expect((await request('/tasks/2', 'PATCH', { completed: true })).status).toBe(200)
  expect((await (await request('/tasks?completed=true')).json()).tasks.map((task: { id: string }) => task.id)).toEqual(['2'])
  expect((await request('/tasks/1', 'DELETE')).status).toBe(204)
  expect((await request('/tasks/1')).status).toBe(404)
})
it('rejects invalid HTTP input and reports real database readiness/metric templates', async () => {
  const { request } = setup()
  expect((await request('/readyz')).status).toBe(200)
  for (const body of [{ title: ' ' }, { title: 'x', completed: true }]) expect((await request('/tasks', 'POST', body)).status).toBe(400)
  for (const path of ['/tasks/not-an-id', '/tasks/9223372036854775808', '/tasks?limit=101', '/tasks?completed=maybe']) expect((await request(path)).status).toBe(400)
  expect((await request('/tasks/999999')).status).toBe(404)
  const metrics = await (await request('/metrics')).text()
  expect(metrics).toContain('route="/tasks/:id"'); expect(metrics).not.toContain('route="/tasks/999999"')
})
it('denies runtime DDL and migration-history access while allowing task DML', async () => {
  const { app, request } = setup(); await request('/readyz')
  const db = app.container.resolve(PgDatabase)
  expect((await db.execute('SELECT current_user AS role')).rows[0]!.role).toBe('longhorn_app')
  expect((await db.execute("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user")).rows[0]!.rolsuper).toBe(false)
  await expect(db.execute('CREATE TABLE longhorn_pg_example.forbidden(id integer)')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('SELECT * FROM longhorn_pg_example.longhorn_migrations')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('DELETE FROM longhorn_queue.jobs')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('DELETE FROM longhorn_scheduler.schedules')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('UPDATE longhorn_pg_example.task_reports SET total=0')).rejects.toMatchObject({ code: '42501' })
  expect((await request('/tasks', 'POST', { title: 'allowed' })).status).toBe(201)
})
it('produces task snapshots through the public report API with an idempotent SQL effect and safe status metadata',async () => {
  const { app,request }=setup()
  await request('/tasks','POST',{ title: 'one' });await request('/tasks','POST',{ title: 'two' });await request('/tasks/2','PATCH',{ completed: true })
  expect((await request('/task-reports','POST',{ scope: 'invalid' })).status).toBe(400)
  const response=await request('/task-reports','POST',{ scope: 'all' })
  expect(response.status).toBe(202)
  const { job }=await response.json();expect(response.headers.get('Location')).toBe('/task-reports/'+job.id)
  expect(job).not.toHaveProperty('payload');expect(job).not.toHaveProperty('leaseToken')
  expect((await (await request('/task-reports/'+job.id)).json()).report).toBeNull()
  const database=app.container.resolve(PgDatabase),queue=app.container.resolve(TaskReportQueue),handler=taskReportHandler(database)
  expect((await queue.runOnce(handler)).status).toBe('succeeded')
  expect((await (await request('/task-reports/'+job.id)).json()).report).toMatchObject({ total: '2',completed: '1',open: '1' })
  await request('/tasks','POST',{ title: 'later' })
  await handler({ scope: 'all' },{ id: job.id,queue: queue.name,attempt: 2,maxAttempts: 3,signal: new AbortController().signal })
  expect((await (await request('/task-reports/'+job.id)).json()).report.total).toBe('2')
  const filtered=await (await request('/task-reports','POST',{ scope: 'completed' })).json()
  await queue.runOnce(handler)
  expect((await (await request('/task-reports/'+filtered.job.id)).json()).report).toMatchObject({ total: '1',completed: '1',open: '0' })
  expect((await request('/task-reports/missing')).status).toBe(404)
})
it('registers immutable report schedules, validates cron, dispatches once and cancels future occurrences',async () => {
  const { app,request }=setup(),body={ id: 'native-http',scope: 'all',schedule: { kind: 'once',at: 0 } }
  expect((await request('/task-report-schedules','POST',body)).status).toBe(200)
  expect((await request('/task-report-schedules','POST',body)).status).toBe(200)
  expect((await request('/task-report-schedules','POST',{ ...body,scope: 'open' })).status).toBe(409)
  expect((await request('/task-report-schedules','POST',{ schedule: { kind: 'cron',expression: 'not a cron' } })).status).toBe(400)
  const scheduler=app.container.resolve(TaskReportScheduler)
  expect((await scheduler.tick()).dispatched).toHaveLength(1)
  const schedule=(await(await request('/task-report-schedules/native-http')).json()).schedule
  expect(schedule).toMatchObject({ state: 'completed',dispatchCount: 1,lastJobId: 'scheduled:native-http:0' })
  expect(schedule).not.toHaveProperty('payload')
  expect((await request('/task-reports/'+schedule.lastJobId)).status).toBe(200)
  expect((await request('/task-report-schedules/native-http','DELETE')).status).toBe(404)
  expect((await request('/task-report-schedules','POST',{ id: 'cancel',schedule: { kind: 'interval',intervalMs: 60000 } })).status).toBe(200)
  expect((await request('/task-report-schedules/cancel','DELETE')).status).toBe(204)
  expect((await scheduler.tick()).dispatched).toEqual([])
})
it('keeps the database alive until an admitted HTTP request finishes and closes its pool afterwards', async () => {
  const { app, request } = setup()
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
  app.http.get('/held', async (c) => { enter(); await gate; return c.json({ ready: true }) })
  const pending = request('/held'); await entered
  const database = app.container.resolve(PgDatabase), closing = app.close()
  expect((await database.execute('SELECT 1 AS value')).rows[0]!.value).toBe(1)
  release(); await pending; await closing
  await expect(database.execute('SELECT 1')).rejects.toThrow('closed')
})
