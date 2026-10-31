import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import type { Database, SqlExecutor } from '@longhornjs/database'
import { Idempotency, IdempotencyConflictError, validIdempotencyKey } from '@longhornjs/idempotency'
import { PostgresIdempotencyStore } from '@longhornjs/idempotency/postgres'
import type { Logger } from '@longhornjs/logger'
import { MetricRegistry, Readiness, Tracer } from '@longhornjs/observability'
import { httpTelemetry, livenessHandler, readinessHandler, requestSpan } from '@longhornjs/observability/hono'
import { MemorySpanExporter } from '@longhornjs/observability/memory'
import { renderPrometheus, PROMETHEUS_CONTENT_TYPE } from '@longhornjs/observability/prometheus'
import { validate } from '@longhornjs/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import { PostgresTasksStore, createTaskSchema, updateTaskSchema, taskParams, taskQuery } from './tasks.js'
import { configureTaskReports, TaskReportQueue } from './background.js'
import { enqueueInTransaction } from '@longhornjs/queue/transaction'
import type { BackgroundOptions } from './background.js'
import { configurePostgresAccounts } from './accounts.js'
import type { AccountOptions } from './accounts.js'
import { configurePostgresOperations } from './operations.js'
import type { AccountOperationsOptions } from './operations.js'
import { configureConsole } from './console.js'
import type { ConsoleAssets } from './console.js'
import { checkPostgresTables } from './postgres-readiness.js'

export const PgDatabase = token<Database>('PostgreSQL example database')
const Tasks = token<PostgresTasksStore>('PostgreSQL tasks')
const TaskRequests = token<Idempotency>('PostgreSQL task request idempotency')
export function createPostgresApp(resources: { openDatabase: () => Promise<Database>; logger?: Logger;accounts?: AccountOptions;operations?: AccountOperationsOptions;console?:ConsoleAssets } & BackgroundOptions): Longhorn {
  if (resources.operations && !resources.accounts) throw new Error('Account operations require account services')
  if(resources.console&&(!resources.accounts||!resources.operations))throw new Error('The console requires account operations')
  const app = new Longhorn(resources.logger ? { logger: resources.logger } : {})
  const readiness = new Readiness(), meter = new MetricRegistry(), tracer = new Tracer({ exporter: new MemorySpanExporter() })
  if(resources.operations?.checkHealth)readiness.add('message-service',({signal})=>resources.operations!.checkHealth!(signal))
  readiness.add('database', async ({ signal }) => {
    if (signal.aborted) return false
    await checkPostgresTables(app.container.resolve(PgDatabase),resources.accounts,resources.operations)
    return true
  })
  app.container.register(provide(Tasks, { deps: [PgDatabase], factory: (database) => new PostgresTasksStore(database) }))
  app.container.register(provide(TaskRequests, { deps: [PgDatabase], factory: database => new Idempotency({ store: new PostgresIdempotencyStore(database) }) }))
  app.onStart(async () => {
    const database = await resources.openDatabase()
    try {
      await checkPostgresTables(database,resources.accounts,resources.operations)
      app.container.register(provide(PgDatabase, { factory: () => database }))
      return () => database.close()
    } catch (error) { try { await database.close() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'PostgreSQL example startup and cleanup failed', { cause: error }) }; throw error }
  })
  app.onStart(() => { readiness.start(); return () => readiness.close() })
  app.onStop(async () => { try { await readiness.close(); await tracer.close() } finally { meter.close() } })
  app.http.use('*', httpTelemetry({ meter, tracer, excludePaths: ['/metrics'] }).middleware)
  app.http.use('*', async (c, next) => { const span = requestSpan(c); if (span) c.set('logger', c.get('logger').child({ traceId: span.context.traceId, spanId: span.context.spanId })); c.header('Cache-Control', 'no-store'); await next() })
  app.http.use('*', bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'Request body too large' }, 413) }))
  app.http.get('/', (c) => c.json({ framework: 'LongHorn', database: 'postgres', endpoints: ['/livez', '/readyz', '/metrics', '/tasks', '/tasks/with-report', '/tasks/:id', '/task-reports', '/task-reports/:id', '/task-report-schedules', '/task-report-schedules/:id',
    ...(resources.accounts ? ['/account/register','/account/login','/account/session','/account/notes'] : []),
    ...(resources.operations ? ['/account/commands','/account/history-views','/account/commands/:id/receipt','/account/operations/deliveries','/account/operations/audit'] : [])] }))
  app.http.get('/livez', livenessHandler(() => app.state !== 'failed' && app.state !== 'stopped'))
  app.http.get('/readyz', readinessHandler(readiness))
  app.http.get('/metrics', (c) => { c.header('Content-Type', PROMETHEUS_CONTENT_TYPE); return c.body(renderPrometheus(meter.snapshot())) })
  app.http.get('/tasks', validate('query', taskQuery), async (c) => c.json(await c.get('container').resolve(Tasks).list(c.req.valid('query'))))
  app.http.post('/tasks', validate('json', createTaskSchema), async (c) => { const task = await c.get('container').resolve(Tasks).create(c.req.valid('json').title); c.header('Location', `/tasks/${task.id}`); return c.json({ task }, 201) })
  app.http.post('/tasks/with-report', validate('json', createTaskSchema), async c => {
    const container = c.get('container'), title = c.req.valid('json').title
    const key = c.req.header('Idempotency-Key')
    if (key !== undefined && !validIdempotencyKey(key)) return c.json({ error: 'Invalid Idempotency-Key' }, 400)
    const create = async (tx: SqlExecutor) => {
      const task = await container.resolve(Tasks).createIn(tx, title)
      const job = await enqueueInTransaction(container.resolve(TaskReportQueue), tx, { scope: 'all' })
      return { task, job }
    }
    try {
      const outcome = key === undefined ? { value: await container.resolve(PgDatabase).transaction(create) } :
        await container.resolve(TaskRequests).run({ scope: 'public:tasks-with-report:v1', key, input: { title } }, create)
      if ('replayed' in outcome) {
        c.header('Idempotency-Replayed', String(outcome.replayed))
        c.header('Idempotency-Expires-At', String(outcome.expiresAt))
      }
      c.header('Location', '/tasks/'+outcome.value.task.id); c.header('Report-Location', '/task-reports/'+outcome.value.job.id)
      return c.json(outcome.value, 201)
    } catch (error) {
      if (error instanceof IdempotencyConflictError) return c.json({ error: 'Idempotency key was already used with different input' }, 409)
      throw error
    }
  })
  app.http.get('/tasks/:id', validate('param', taskParams), async (c) => { const task = await c.get('container').resolve(Tasks).get(c.req.valid('param').id); return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404) })
  app.http.patch('/tasks/:id', validate('param', taskParams), validate('json', updateTaskSchema), async (c) => { const task = await c.get('container').resolve(Tasks).update(c.req.valid('param').id, c.req.valid('json').completed); return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404) })
  app.http.delete('/tasks/:id', validate('param', taskParams), async (c) => await c.get('container').resolve(Tasks).delete(c.req.valid('param').id) ? c.body(null, 204) : c.json({ error: 'Task not found' }, 404))
  configureTaskReports(app,PgDatabase,resources)
  if (resources.accounts) {
    const access = configurePostgresAccounts(app,PgDatabase,resources.accounts)
    if (resources.operations) configurePostgresOperations(app,PgDatabase,access,resources.operations)
  }
  if(resources.console)configureConsole(app,resources.console,{passwordChanges:resources.accounts?.passwordChanges??false,sessionControls:resources.accounts?.sessionControls??false,sessionInventory:resources.accounts?.sessionInventory??false})
  return app
}
