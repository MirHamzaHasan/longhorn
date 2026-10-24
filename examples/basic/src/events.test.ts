import { afterEach, expect, it } from 'vitest'
import { createLogger } from '@longhorn/logger'
import { defineEvent } from '@longhorn/events'
import { nodeRuntime } from '@longhorn/node'
import type { Longhorn } from '@longhorn/core'
import { createApp } from './app.js'
import { defaultConfig } from './config.js'
import { configureSqliteStorage, TaskDatabase } from './storage.js'
import { TaskActivity, TaskCreated, TaskDeleted, TaskEvents, TaskUpdated } from './task-events.js'
import { createTestApp } from './test-support.js'

const apps: Longhorn[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })
function databaseApp(logger = createLogger({ level: 'silent' })) {
  const app = configureSqliteStorage(createApp(defaultConfig, logger), ':memory:')
  apps.push(app)
  return app
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const body = (method: string, value: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

it('observes committed CRUD over TCP and correlates activity with response request IDs', async () => {
  const app = databaseApp()
  const server = await app.listen(nodeRuntime, { port: 0 })
  expect(await (await fetch(`${server.url}/activity`)).json()).toEqual({ activity: { created: 0, updated: 0, deleted: 0 } })
  const created = await fetch(`${server.url}/tasks`, body('POST', { title: 'Private task title' }))
  const task = (await created.json()).task
  let activity = (await (await fetch(`${server.url}/activity`)).json()).activity
  expect(activity).toMatchObject({ created: 1, updated: 0, deleted: 0,
    latest: { name: 'task.created', taskId: task.id, requestId: created.headers.get('X-Request-Id') } })
  await fetch(`${server.url}/tasks/${task.id}`, body('PATCH', { completed: true }))
  const deleted = await fetch(`${server.url}/tasks/${task.id}`, { method: 'DELETE' })
  activity = (await (await fetch(`${server.url}/activity`)).json()).activity
  expect(activity).toEqual({ created: 1, updated: 1, deleted: 1,
    latest: { name: 'task.deleted', taskId: task.id, requestId: deleted.headers.get('X-Request-Id'), eventId: expect.any(String) } })
  expect(JSON.stringify(activity)).not.toContain(task.title)
  await fetch(`${server.url}/tasks/${task.id}`, { method: 'DELETE' })
  await fetch(`${server.url}/tasks/${task.id}`, body('PATCH', { completed: false }))
  await fetch(`${server.url}/tasks`, body('POST', { title: '' }))
  expect((await (await fetch(`${server.url}/activity`)).json()).activity).toEqual(activity)
})

it('retains successful writes when observers fail and logs delivery metadata without thrown payloads', async () => {
  const records: unknown[] = []
  const app = databaseApp(createLogger({ sink: (record) => records.push(record) }))
  const events = app.container.resolve(TaskEvents)
  const secret = 'task title that must not enter logs'
  events.on(TaskCreated, (payload) => { throw payload })
  events.on(TaskUpdated, (payload) => { throw payload })
  events.on(TaskDeleted, () => { throw new Error(secret) })
  const created = await app.fetch(new Request('http://localhost/tasks', body('POST', { title: secret })))
  expect(created.status).toBe(201)
  const task = (await created.json()).task
  expect((await app.fetch(new Request(`http://localhost/tasks/${task.id}`, body('PATCH', { completed: true })))).status).toBe(200)
  expect((await app.fetch(new Request(`http://localhost/tasks/${task.id}`, { method: 'DELETE' }))).status).toBe(204)
  expect((await app.fetch(new Request('http://localhost/tasks'))).status).toBe(200)
  expect(app.container.resolve(TaskActivity).snapshot()).toMatchObject({ created: 1, updated: 1, deleted: 1 })
  expect(JSON.stringify(records)).toContain('Task event delivery failed')
  expect(JSON.stringify(records)).not.toContain(secret)
})

it('emits nothing for a failed store mutation and isolates activity between apps', async () => {
  const app = createApp(defaultConfig, undefined, {
    list: async () => ({ tasks: [], nextCursor: null }), counts: async () => ({ total: 0, completed: 0, pending: 0 }), get: async () => undefined,
    create: async () => { throw new Error('write failed') },
    update: async () => undefined, delete: async () => false,
  })
  apps.push(app)
  expect((await app.fetch(new Request('http://localhost/tasks', body('POST', { title: 'Not saved' })))).status).toBe(500)
  expect(app.container.resolve(TaskActivity).snapshot()).toEqual({ created: 0, updated: 0, deleted: 0 })
  const separate = createTestApp(); apps.push(separate)
  await separate.fetch(new Request('http://localhost/tasks', body('POST', { title: 'Saved' })))
  expect(separate.container.resolve(TaskActivity).snapshot()).toMatchObject({ created: 1 })
  expect(app.container.resolve(TaskActivity).snapshot()).toEqual({ created: 0, updated: 0, deleted: 0 })
})

it('drains external event work and its follow-ups before closing SQLite', async () => {
  const app = databaseApp()
  await app.start()
  const database = app.container.resolve(TaskDatabase)
  const events = app.container.resolve(TaskEvents)
  const Followup = defineEvent<void>('database.followup')
  const entered = deferred(); const gate = deferred()
  let queryCompleted = false
  events.on(TaskCreated, async (_, context) => { entered.resolve(); await gate.promise; await context.emit(Followup, undefined) })
  events.on(Followup, async () => { await database.execute('SELECT 1'); queryCompleted = true })
  const dispatch = events.emit(TaskCreated, { task: { id: 'test', title: 'test', completed: false } })
  await entered.promise
  const closing = app.close()
  expect((await database.execute('SELECT 1')).rows).toHaveLength(1)
  expect(queryCompleted).toBe(false)
  gate.resolve(); await dispatch; await closing
  expect(queryCompleted).toBe(true)
  expect(events.state).toBe('closed')
  expect(events.listenerCount(TaskCreated)).toBe(0)
  await expect(database.execute('SELECT 1')).rejects.toThrow('closed')
})

it('rolls back event ownership and SQLite when later startup fails', async () => {
  const app = databaseApp()
  app.onStart(() => { throw new Error('later startup failed') })
  await expect(app.start()).rejects.toThrow('later startup failed')
  expect(app.container.resolve(TaskEvents).state).toBe('closed')
  await expect(app.container.resolve(TaskDatabase).execute('SELECT 1')).rejects.toThrow('closed')
})
