import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Longhorn } from '@longhorn/core'
import { nodeRuntime } from '@longhorn/node'
import { createApp } from './app.js'
import { configureSqliteStorage, TaskDatabase } from './storage.js'

const apps: Longhorn[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function app(filename: string) {
  const app = configureSqliteStorage(createApp(), filename)
  apps.push(app)
  return app
}

async function path() {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-tasks-'))
  directories.push(directory)
  return join(directory, 'tasks.sqlite')
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

it('keeps tasks and their completion state when the application is reopened', async () => {
  const filename = await path()
  const first = app(filename)
  const created = await first.fetch(new Request('http://localhost/tasks', json('POST', { title: '  Persist me  ' })))
  expect(created.status).toBe(201)
  const task = (await created.json()).task
  await first.fetch(new Request(`http://localhost/tasks/${task.id}`, json('PATCH', { completed: true })))
  const database = first.container.resolve(TaskDatabase)
  await first.close()
  await expect(database.execute('SELECT 1')).rejects.toThrow(/closed/)

  const second = app(filename)
  expect(await (await second.fetch(new Request('http://localhost/tasks'))).json()).toEqual({
    tasks: [{ id: task.id, title: 'Persist me', completed: true }],
  })
  const next = await second.fetch(new Request('http://localhost/tasks', json('POST', { title: 'Next task' })))
  expect((await next.json()).task.id).not.toBe(task.id)
})

it('creates unique durable tasks under concurrent real HTTP requests', async () => {
  const application = app(await path())
  const server = await application.listen(nodeRuntime, { port: 0 })
  const created = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
    const response = await fetch(`${server.url}/tasks`, json('POST', { title: `Task ${index}` }))
    expect(response.status).toBe(201)
    return (await response.json()).task
  }))
  expect(new Set(created.map((task) => task.id)).size).toBe(25)
  const response = await fetch(`${server.url}/tasks`)
  expect((await response.json()).tasks).toHaveLength(25)
})

it('treats SQL-looking titles and IDs as values, with missing tasks returning 404', async () => {
  const application = app(':memory:')
  const title = "x'); DROP TABLE tasks; --"
  const created = await application.fetch(new Request('http://localhost/tasks', json('POST', { title })))
  expect((await created.json()).task.title).toBe(title)
  const response = await application.fetch(new Request('http://localhost/tasks/1%20OR%201=1'))
  expect(response.status).toBe(404)
  expect((await (await application.fetch(new Request('http://localhost/tasks'))).json()).tasks).toHaveLength(1)
})

it('deletes durably and does not reuse an old task ID', async () => {
  const filename = await path()
  const first = app(filename)
  const created = await first.fetch(new Request('http://localhost/tasks', json('POST', { title: 'Delete me' })))
  const id = (await created.json()).task.id
  expect((await first.fetch(new Request(`http://localhost/tasks/${id}`, { method: 'DELETE' }))).status).toBe(204)
  await first.close()
  const second = app(filename)
  expect((await second.fetch(new Request(`http://localhost/tasks/${id}`))).status).toBe(404)
  const next = await second.fetch(new Request('http://localhost/tasks', json('POST', { title: 'New task' })))
  expect((await next.json()).task.id).not.toBe(id)
})

it('closes the real database when server binding fails', async () => {
  const application = app(':memory:')
  await expect(application.listen({ name: 'unavailable', serve: async () => { throw new Error('busy') } }))
    .rejects.toThrow('busy')
  await expect(application.container.resolve(TaskDatabase).execute('SELECT 1')).rejects.toThrow(/closed/)
})
