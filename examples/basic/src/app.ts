import { Longhorn } from '@longhornjs/core'
import { provide, token } from '@longhornjs/container'
import { validate } from '@longhornjs/validation/hono'
import { AppSettings, defaultConfig } from './config.js'
import type { AppConfig } from './config.js'
import type { Logger } from '@longhornjs/logger'
import { createTaskSchema, updateTaskSchema, taskListQuery } from './schemas.js'
import { TasksService, TasksStoreToken } from './tasks.js'
import type { TasksStore } from './tasks.js'
import { registerTaskEvents, TaskActivity, TaskEvents } from './task-events.js'
import { configureTaskCache, registerTaskCache, TaskSummaryCache } from './task-cache.js'

const Tasks = token<TasksService>('tasks')

export function createApp(config: AppConfig = defaultConfig, logger?: Logger, store?: TasksStore): Longhorn {
  const app = new Longhorn(logger ? { logger } : {}).runtime({ name: 'api', adapter: 'node' })
  app.container.register(provide(AppSettings, { factory: () => config }))
  registerTaskEvents(app)
  registerTaskCache(app)
  if (store) app.container.register(provide(TasksStoreToken, { factory: () => store }))
  app.container.register(provide(Tasks, { deps: [TasksStoreToken, TaskEvents, TaskSummaryCache] as const,
    factory: (tasks, events, cache) => new TasksService(tasks, events, app.logger, cache) }))
  if (store) configureTaskCache(app)

  app.http.get('/', (c) => c.json({
    framework: 'LongHorn',
    name: c.get('container').resolve(AppSettings).appName,
    message: 'Your LongHorn app is running',
    endpoints: ['/health', '/tasks', '/activity', '/summary'],
  }))
  app.http.get('/health', (c) => c.json({ status: 'ok' }))
  app.http.get('/activity', (c) => c.json({ activity: c.get('container').resolve(TaskActivity).snapshot() }))
  app.http.get('/summary', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ summary: await c.get('container').resolve(Tasks).summary() })
  })

  app.http.get('/tasks', async (c, next) => {
    if (Object.values(c.req.queries()).some(values => values.length !== 1)) return c.json({ error: 'Invalid task query' }, 400)
    await next()
  }, validate('query', taskListQuery), async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await c.get('container').resolve(Tasks).list(c.req.valid('query')))
  })

  app.http.post('/tasks', validate('json', createTaskSchema), async (c) => {
    const body = c.req.valid('json')
    const task = await c.get('container').resolve(Tasks).create(body.title, c.get('requestId'))
    c.header('Location', `/tasks/${task.id}`)
    return c.json({ task }, 201)
  })

  app.http.get('/tasks/:id', async (c) => {
    const task = await c.get('container').resolve(Tasks).get(c.req.param('id'))
    return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404)
  })

  app.http.patch('/tasks/:id', validate('json', updateTaskSchema), async (c) => {
    const body = c.req.valid('json')
    const task = await c.get('container').resolve(Tasks).update(c.req.param('id'), body.completed, c.get('requestId'))
    return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404)
  })

  app.http.delete('/tasks/:id', async (c) => {
    return await c.get('container').resolve(Tasks).delete(c.req.param('id'), c.get('requestId'))
      ? c.body(null, 204)
      : c.json({ error: 'Task not found' }, 404)
  })

  return app
}
