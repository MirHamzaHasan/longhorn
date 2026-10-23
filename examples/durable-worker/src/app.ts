import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { migrate } from '@longhorn/database'
import type { Database, Migration } from '@longhorn/database'
import { Queue } from '@longhorn/queue'
import { SqliteQueueStore } from '@longhorn/queue/sqlite'
import { Scheduler, ScheduleConflictError, ScheduleInputError } from '@longhorn/scheduler'
import { SqliteSchedulerStore } from '@longhorn/scheduler/sqlite'
import { validate } from '@longhorn/validation/hono'
import { createDurableSqlite } from '@longhorn/workers/durable-sqlite'
import type { DurableSqliteState } from '@longhorn/workers/durable-sqlite'
import type { SqliteAlarmClock } from '@longhorn/workers/sqlite-alarms'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { migrations, reportHandler, reportSchema, reportQueueName } from './reports.js'
import type { ReportInput } from './reports.js'

const ReportDatabase = token<Database>('durable report database')
const ReportQueue = token<Queue<ReportInput>>('durable report queue')
const ReportScheduler = token<Scheduler>('durable report scheduler')
export const ReportClock = token<SqliteAlarmClock>('durable report alarm clock')
type ReportAppOptions = { migrations?: readonly Migration[]; clock?: (app: Longhorn, database: Database) => SqliteAlarmClock }
const scheduleSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  numbers: reportSchema.shape.numbers,
  at: z.number().int().nonnegative().max(8_640_000_000_000_000),
}).strict()

/** Each Object owns one app/DI/lifecycle and one private queue/schedule/effect database. */
export function createReportApp(state: DurableSqliteState, options: ReportAppOptions = {}): Longhorn {
  // Constructing the borrowed handle does no SQL I/O; migrations remain lifecycle-owned.
  const app = new Longhorn(), database = createDurableSqlite(state), clock = options.clock?.(app, database)
  if (clock) app.container.register(provide(ReportClock, { factory: () => clock }))
  app.onStart(async () => {
    try {
      await migrate(database, options.migrations ?? migrations)
      app.container.register(provide(ReportDatabase, { factory: () => database }))
      return () => database.close()
    } catch (error) { await database.close(); throw error }
  })
  if (clock) app.onStart(async () => { await clock.start(); return () => clock.close() })
  app.container.register(provide(ReportQueue, { deps: [ReportDatabase], factory: database => new Queue({
    name: reportQueueName, schema: reportSchema, store: new SqliteQueueStore(database),
  }) }))
  app.container.register(provide(ReportScheduler, { deps: [ReportDatabase], factory: database => new Scheduler({ store: new SqliteSchedulerStore(database) }) }))
  app.onStart(() => { const queue = app.container.resolve(ReportQueue); return () => queue.close() })
  app.onStart(() => { const scheduler = app.container.resolve(ReportScheduler); return () => scheduler.close() })
  app.http.use('*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request body too large' }, 413) }))
  app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.http.get('/health', c => c.json({ status: 'ok', storage: 'durable-object-sqlite' }))
  if (clock) app.http.get('/alarm', async c => c.json({ clock: clock.stats(), nextAlarm: await clock.getAlarm() }))
  app.http.post('/reports', validate('json', reportSchema), async c => {
    const job = await app.container.resolve(ReportQueue).enqueue(c.req.valid('json'))
    c.header('Location', '/reports/'+job.id); return c.json({ job }, 202)
  })
  app.http.get('/reports/:id', async c => {
    const id = c.req.param('id'), job = await app.container.resolve(ReportQueue).get(id)
    if (!job) return c.json({ error: 'Report not found' }, 404)
    const row = (await app.container.resolve(ReportDatabase).execute({ sql: 'SELECT result FROM worker_reports WHERE job_id = ?', args: [id] })).rows[0]
    return c.json({ job, result: row ? JSON.parse(String(row.result)) as unknown : null })
  })
  app.http.post('/report-schedules', validate('json', scheduleSchema), async c => {
    const { id, numbers, at } = c.req.valid('json')
    try {
      const schedule = await app.container.resolve(ReportScheduler).at(app.container.resolve(ReportQueue), { numbers }, { id, at })
      c.header('Location', '/report-schedules/'+schedule.id); return c.json({ schedule }, 201)
    } catch (error) {
      if (error instanceof ScheduleConflictError) return c.json({ error: 'Schedule definition conflicts' }, 409)
      if (error instanceof ScheduleInputError) return c.json({ error: 'Invalid schedule' }, 400)
      throw error
    }
  })
  app.http.get('/report-schedules/:id', async c => {
    const schedule = await app.container.resolve(ReportScheduler).get(c.req.param('id'))
    return schedule ? c.json({ schedule }) : c.json({ error: 'Schedule not found' }, 404)
  })
  app.http.delete('/report-schedules/:id', async c => await app.container.resolve(ReportScheduler).cancel(c.req.param('id'))
    ? c.body(null, 204) : c.json({ error: 'Active schedule not found' }, 404))
  // Only the outer Worker's scheduled handler calls this route; it is not proxied publicly.
  app.http.post('/_tick', async c => {
    try { return c.json(await runReportBatch(app, 10)) }
    catch { return c.json({ error: 'A report attempt did not succeed' }, 503) }
  })
  return app
}

export async function runReportBatch(app: Longhorn, limit: number, signal?: AbortSignal): Promise<{ dispatched: number; processed: number }> {
  signal?.throwIfAborted()
  const tick = await app.container.resolve(ReportScheduler).tick({ limit }), database = app.container.resolve(ReportDatabase)
  let processed = 0
  for (let i=0; i<limit; i++) {
    signal?.throwIfAborted()
    const result = await app.container.resolve(ReportQueue).runOnce(async (data, job) => {
      signal?.throwIfAborted(); await reportHandler(database)(data, job); signal?.throwIfAborted()
    })
    if (result.status === 'idle') break
    if (result.status !== 'succeeded') throw new Error('A report attempt did not succeed')
    processed++
  }
  signal?.throwIfAborted()
  return { dispatched: tick.dispatched.length, processed }
}
