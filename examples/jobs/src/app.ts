import { Longhorn } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import type { Logger } from '@longhorn/logger'
import type { BufferedLogProcessor, MetricExporter, SpanExporter } from '@longhorn/observability'
import { requestSpan } from '@longhorn/observability/hono'
import { Queue, QueueStoreError, QueueWorker } from '@longhorn/queue'
import { queueMigrations, SqliteQueueStore } from '@longhorn/queue/sqlite'
import { Scheduler, SchedulerRunner, ScheduleConflictError, ScheduleInputError, SchedulerStoreError } from '@longhorn/scheduler'
import { schedulerMigrations, SqliteSchedulerStore } from '@longhorn/scheduler/sqlite'
import { validate } from '@longhorn/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppConfig } from './config.js'
import { reportHandler, reportMigrations, reportQueueName, reportSchema } from './reports.js'
import type { ReportInput } from './reports.js'
import { reportScheduleSchema } from './schedules.js'
import { configureDiagnostics } from './diagnostics.js'
import { createJobsLogging } from './logging.js'

export const ReportDatabase = token<Database>('report database')
export const ReportQueue = token<Queue<ReportInput>>('report queue')
export const ReportWorker = token<QueueWorker<ReportInput>>('report worker')
export const ReportScheduler = token<Scheduler>('report scheduler')
export const ReportScheduleRunner = token<SchedulerRunner>('report schedule runner')

export function createJobsApp(config: AppConfig, resources: { openDatabase: () => Promise<Database>; logger?: Logger; now?: () => number; exporter?: SpanExporter; metricExporter?: MetricExporter; logs?: BufferedLogProcessor }): Longhorn {
  const selected = !resources.logger && !resources.logs && config.otlpLogs ? createJobsLogging(config) : undefined
  const logger = resources.logger ?? selected?.logger, logs = resources.logs ?? selected?.processor
  const app = new Longhorn(logger ? { logger } : {})
  // Registered first so final log drain runs after diagnostics and all other stop hooks.
  if (logs) app.onStop(() => logs.close())
  const diagnostics = configureDiagnostics(app, config, {
    database: () => app.container.resolve(ReportDatabase), worker: () => app.container.resolve(ReportWorker).snapshot(),
    scheduler: () => app.container.resolve(ReportScheduleRunner).snapshot(), ...(resources.exporter ? { exporter: resources.exporter } : {}),
    ...(resources.metricExporter ? { metricExporter: resources.metricExporter } : {}),
    ...(logs ? { logs } : {}),
  })
  app.container.register(provide(ReportQueue, { deps: [ReportDatabase], factory: (database) => new Queue({
    name: reportQueueName, schema: reportSchema, store: new SqliteQueueStore(database),
    ...(resources.now ? { now: resources.now } : {}),
  }) }))
  app.container.register(provide(ReportScheduler, { deps: [ReportDatabase], factory: (database) => new Scheduler({
    store: new SqliteSchedulerStore(database), ...(resources.now ? { now: resources.now } : {}),
  }) }))
  app.container.register(provide(ReportScheduleRunner, { deps: [ReportScheduler], factory: (scheduler) => new SchedulerRunner(scheduler, {
    pollIntervalMs: 100,
    onError: (error) => { diagnostics.backgroundError('scheduler'); app.logger.error('Report schedule operation failed', {
      operation: error instanceof SchedulerStoreError ? error.operation : 'runner',
    }) },
  }) }))
  app.container.register(provide(ReportWorker, { deps: [ReportQueue, ReportDatabase] as const, factory: (queue, database) => new QueueWorker(
    queue, diagnostics.handler(reportHandler(database)), { concurrency: 2, pollIntervalMs: 100,
      onError: (error) => { diagnostics.backgroundError('worker'); app.logger.error('Report worker operation failed', {
        operation: error instanceof QueueStoreError ? error.operation : 'worker',
      }) },
    },
  ) }))
  app.onStart(async () => {
    const database = await resources.openDatabase()
    try {
      await migrate(database, [...queueMigrations, ...reportMigrations, ...schedulerMigrations])
      app.container.register(provide(ReportDatabase, { factory: () => database }))
      app.logger.info('Jobs database ready')
      return () => database.close()
    } catch (error) {
      try { await database.close() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Jobs startup and cleanup failed', { cause: error })
      }
      throw error
    }
  })
  app.onStart(() => {
    const queue = app.container.resolve(ReportQueue)
    return () => queue.close()
  })
  app.onStart(() => {
    const scheduler = app.container.resolve(ReportScheduler)
    return () => scheduler.close()
  })
  app.onStart(() => {
    if (!config.workerEnabled) return
    const worker = app.container.resolve(ReportWorker)
    worker.start()
    app.logger.info('Report worker started')
    return () => worker.close()
  })
  app.onStart(() => {
    if (!config.schedulerEnabled) return
    const runner = app.container.resolve(ReportScheduleRunner)
    runner.start(); app.logger.info('Report scheduler started')
    return () => runner.close()
  })
  app.onStart(() => { diagnostics.readiness.start(); diagnostics.startMetrics(); return () => diagnostics.readiness.close() })
  app.http.use('*', bodyLimit({ maxSize: 65_536, onError: (c) => c.json({ error: 'Request body too large' }, 413) }))
  app.http.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.http.get('/', (c) => c.json({ framework: 'LongHorn', endpoints: ['/health', '/livez', '/readyz', '/metrics', '/traces', '/diagnostics', '/reports', '/reports/:id', '/report-schedules', '/report-schedules/:id'] }))
  app.http.get('/health', (c) => c.json({ status: 'ok', workerEnabled: config.workerEnabled, schedulerEnabled: config.schedulerEnabled }))
  app.http.post('/report-schedules', validate('json', reportScheduleSchema), async (c) => {
    const { numbers, id, schedule } = c.req.valid('json')
    const container = c.get('container'), scheduler = container.resolve(ReportScheduler), queue = container.resolve(ReportQueue)
    const options = id === undefined ? {} : { id }
    try {
      let registered
      if (schedule.kind === 'once') registered = await scheduler.at(queue, { numbers }, { ...options, at: schedule.at })
      else {
        const recurring = { ...options,
          ...(schedule.startAt === undefined ? {} : { startAt: schedule.startAt }),
          ...(schedule.missed === undefined ? {} : { missed: schedule.missed }),
        }
        registered = schedule.kind === 'interval'
          ? await scheduler.every(queue, { numbers }, { ...recurring, intervalMs: schedule.intervalMs })
          : await scheduler.cron(queue, { numbers }, { ...recurring, expression: schedule.expression })
      }
      c.header('Location', `/report-schedules/${registered.id}`)
      return c.json({ schedule: registered })
    } catch (error) {
      if (error instanceof ScheduleInputError) return c.json({ error: error.message }, 400)
      if (error instanceof ScheduleConflictError) return c.json({ error: error.message }, 409)
      throw error
    }
  })
  app.http.get('/report-schedules/:id', async (c) => {
    const schedule = await c.get('container').resolve(ReportScheduler).get(c.req.param('id'))
    return schedule ? c.json({ schedule }) : c.json({ error: 'Report schedule not found' }, 404)
  })
  app.http.delete('/report-schedules/:id', async (c) => {
    return await c.get('container').resolve(ReportScheduler).cancel(c.req.param('id'))
      ? c.body(null, 204) : c.json({ error: 'Active report schedule not found' }, 404)
  })
  app.http.post('/reports', validate('json', reportSchema), async (c) => {
    const job = await diagnostics.producer(() => c.get('container').resolve(ReportQueue).enqueue(c.req.valid('json')), requestSpan(c)?.context)
    c.header('Location', `/reports/${job.id}`)
    return c.json({ job }, 202)
  })
  app.http.get('/reports/:id', async (c) => {
    const container = c.get('container')
    const job = await container.resolve(ReportQueue).get(c.req.param('id'))
    if (!job) return c.json({ error: 'Report job not found' }, 404)
    const row = (await container.resolve(ReportDatabase).execute({ sql: 'SELECT result FROM example_reports WHERE job_id = ?', args: [job.id] })).rows[0]
    return c.json({ job, report: row ? JSON.parse(String(row.result)) as unknown : null })
  })
  return app
}
