import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Longhorn } from '@longhorn/core'
import { nodeRuntime } from '@longhorn/node'
import { openSqlite } from '@longhorn/node/sqlite'
import { migrate } from '@longhorn/database'
import { createApp } from './app.js'
import { configureSqliteStorage, TaskDatabase } from './storage.js'
import { taskMigrations } from './sqlite-tasks.js'

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
    tasks: [{ id: task.id, title: 'Persist me', completed: true }], nextCursor: null,
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
  const response = await fetch(`${server.url}/tasks?limit=100`)
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

it('pages by exact numeric IDs across digit boundaries, deletion and int64 cursors', async () => {
  const application = app(':memory:'); await application.start()
  const database = application.container.resolve(TaskDatabase)
  const ids = [1n, 2n, 9n, 10n, 11n, 9007199254740993n, 9007199254740994n, 9223372036854775807n]
  await database.transaction(async tx => {
    for (const [index, id] of ids.entries()) await tx.execute({ sql: 'INSERT INTO tasks(id,title,completed) VALUES(?,?,?)', args: [id, 'task ' + id, index % 2 === 0] })
  })
  const page = async (query: string) => {
    const response = await application.fetch(new Request('http://localhost/tasks?' + query))
    expect(response.status).toBe(200); return response.json()
  }
  const first = await page('limit=3')
  expect(first.tasks.map((task: { id: string }) => task.id)).toEqual(['1', '2', '9']); expect(first.nextCursor).toBe('9')
  await database.execute('DELETE FROM tasks WHERE id=9')
  const second = await page('limit=3&after=' + first.nextCursor)
  expect(second.tasks.map((task: { id: string }) => task.id)).toEqual(['10', '11', '9007199254740993'])
  expect(second.nextCursor).toBe('9007199254740993')
  const last = await page('limit=3&after=' + second.nextCursor)
  expect(last.tasks.map((task: { id: string }) => task.id)).toEqual(['9007199254740994', '9223372036854775807'])
  expect(last.nextCursor).toBeNull()
  expect((await page('limit=2&completed=true&after=10')).tasks.map((task: { id: string }) => task.id)).toEqual(['11', '9007199254740994'])
  expect(await page('after=9223372036854775807')).toEqual({ tasks: [], nextCursor: null })
  expect((await (await application.fetch(new Request('http://localhost/summary'))).json()).summary).toMatchObject({ total: 7, completed: 3, pending: 4 })
})

it('upgrades the retained original schema without rewriting its checksum or tasks', async () => {
  const filename = await path(), legacy = await openSqlite({ filename })
  try {
    await migrate(legacy, taskMigrations.slice(0, 1))
    expect((await legacy.execute('SELECT checksum FROM longhorn_migrations')).rows[0]?.checksum)
      .toBe('9adcc799e7043fa9130be0208cdf4271c97a707d0453bd3b2ec5ac752328dcdf')
    await legacy.execute("INSERT INTO tasks(id,title,completed) VALUES(9,'retained before pages',1)")
  } finally { await legacy.close() }
  const application = app(filename)
  expect((await (await application.fetch(new Request('http://localhost/tasks?completed=true'))).json()).tasks)
    .toEqual([{ id: '9', title: 'retained before pages', completed: true }])
  const database = application.container.resolve(TaskDatabase)
  const history = (await database.execute('SELECT id, checksum FROM longhorn_migrations ORDER BY position')).rows
  expect(history).toHaveLength(2)
  expect(history[0]).toEqual({ id: '001_create_tasks', checksum: '9adcc799e7043fa9130be0208cdf4271c97a707d0453bd3b2ec5ac752328dcdf' })
  expect(history[1]?.id).toBe('002_index_tasks_completed_id')
  expect((await database.execute("PRAGMA index_list('tasks')")).rows.some(row => row.name === 'tasks_completed_id')).toBe(true)
  await migrate(database, taskMigrations)
  expect((await database.execute('SELECT count(*) AS n FROM longhorn_migrations')).rows[0]?.n).toBe(2n)
})
