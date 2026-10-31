import type { Longhorn } from '@longhornjs/core'
import { provide,token } from '@longhornjs/container'
import type { Token } from '@longhornjs/container'
import type { Database } from '@longhornjs/database'
import { Queue,QueueWorker } from '@longhornjs/queue'
import { PostgresQueueStore } from '@longhornjs/queue/postgres'
import { Scheduler,SchedulerRunner,ScheduleConflictError,ScheduleInputError } from '@longhornjs/scheduler'
import { PostgresSchedulerStore } from '@longhornjs/scheduler/postgres'
import { validate } from '@longhornjs/validation/hono'
import { reportParams,taskReport,taskReportHandler,taskReportQueueName,taskReportSchema,taskReportScheduleSchema } from './reports.js'
import type { TaskReportInput } from './reports.js'

export const TaskReportQueue = token<Queue<TaskReportInput>>('PostgreSQL task report queue')
export const TaskReportWorker = token<QueueWorker<TaskReportInput>>('PostgreSQL task report worker')
export const TaskReportScheduler = token<Scheduler>('PostgreSQL task report scheduler')
export const TaskReportRunner = token<SchedulerRunner>('PostgreSQL task report timing host')
export type BackgroundOptions = { readonly workerEnabled?: boolean;readonly schedulerEnabled?: boolean }

export function configureTaskReports(app: Longhorn,databaseToken: Token<Database>,options: BackgroundOptions): void {
  app.container.register(provide(TaskReportQueue,{ deps: [databaseToken],factory: database => new Queue({ name: taskReportQueueName,schema: taskReportSchema,store: new PostgresQueueStore(database) }) }))
  app.container.register(provide(TaskReportScheduler,{ deps: [databaseToken],factory: database => new Scheduler({ store: new PostgresSchedulerStore(database) }) }))
  app.container.register(provide(TaskReportWorker,{ deps: [TaskReportQueue,databaseToken] as const,factory: (queue,database) => new QueueWorker(queue,taskReportHandler(database),{
    concurrency: 2,pollIntervalMs: 100,onError: () => app.logger.error('PostgreSQL report worker operation failed'),
  }) }))
  app.container.register(provide(TaskReportRunner,{ deps: [TaskReportScheduler],factory: scheduler => new SchedulerRunner(scheduler,{
    pollIntervalMs: 100,onError: () => app.logger.error('PostgreSQL report schedule operation failed'),
  }) }))
  app.onStart(() => { const queue=app.container.resolve(TaskReportQueue);return () => queue.close() })
  app.onStart(() => { const scheduler=app.container.resolve(TaskReportScheduler);return () => scheduler.close() })
  app.onStart(() => {
    if (!options.workerEnabled) return
    const worker=app.container.resolve(TaskReportWorker);worker.start();return () => worker.close()
  })
  app.onStart(() => {
    if (!options.schedulerEnabled) return
    const runner=app.container.resolve(TaskReportRunner);runner.start();return () => runner.close()
  })
  app.http.post('/task-reports',validate('json',taskReportSchema),async c => {
    const job=await c.get('container').resolve(TaskReportQueue).enqueue(c.req.valid('json'))
    c.header('Location',`/task-reports/${job.id}`);return c.json({ job },202)
  })
  app.http.get('/task-reports/:id',validate('param',reportParams),async c => {
    const container=c.get('container'),job=await container.resolve(TaskReportQueue).get(c.req.valid('param').id)
    if (!job) return c.json({ error: 'Task report not found' },404)
    return c.json({ job,report: await taskReport(container.resolve(databaseToken),job.id) })
  })
  app.http.post('/task-report-schedules',validate('json',taskReportScheduleSchema),async c => {
    const { id,scope,schedule }=c.req.valid('json'),container=c.get('container')
    const scheduler=container.resolve(TaskReportScheduler),queue=container.resolve(TaskReportQueue),base=id===undefined ? {} : { id }
    try {
      const recurring={ ...base,...('startAt' in schedule && schedule.startAt!==undefined ? { startAt: schedule.startAt } : {}),
        ...('missed' in schedule && schedule.missed!==undefined ? { missed: schedule.missed } : {}) }
      const registered=schedule.kind==='once' ? await scheduler.at(queue,{ scope },{ ...base,at: schedule.at })
        : schedule.kind==='interval' ? await scheduler.every(queue,{ scope },{ ...recurring,intervalMs: schedule.intervalMs })
        : await scheduler.cron(queue,{ scope },{ ...recurring,expression: schedule.expression })
      c.header('Location',`/task-report-schedules/${registered.id}`);return c.json({ schedule: registered })
    } catch (error) {
      if (error instanceof ScheduleInputError) return c.json({ error: error.message },400)
      if (error instanceof ScheduleConflictError) return c.json({ error: error.message },409)
      throw error
    }
  })
  app.http.get('/task-report-schedules/:id',validate('param',reportParams),async c => {
    const schedule=await c.get('container').resolve(TaskReportScheduler).get(c.req.valid('param').id)
    return schedule ? c.json({ schedule }) : c.json({ error: 'Task report schedule not found' },404)
  })
  app.http.delete('/task-report-schedules/:id',validate('param',reportParams),async c => await c.get('container').resolve(TaskReportScheduler).cancel(c.req.valid('param').id)
    ? c.body(null,204) : c.json({ error: 'Active task report schedule not found' },404))
}
