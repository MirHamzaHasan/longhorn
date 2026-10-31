import { afterEach, expect, it, vi } from 'vitest'
import { Cache } from '@longhornjs/cache'
import { MemoryCacheStore } from '@longhornjs/cache/memory'
import { provide } from '@longhornjs/container'
import { createLogger } from '@longhornjs/logger'
import { defineEvent } from '@longhornjs/events'
import type { Longhorn } from '@longhornjs/core'
import { createApp } from './app.js'
import { defaultConfig } from './config.js'
import { TaskSummaryCache } from './task-cache.js'
import { TaskEvents } from './task-events.js'
import { configureSqliteStorage, TaskDatabase } from './storage.js'
import type { Task, TaskSummary, TasksStore } from './tasks.js'

const applications: Longhorn[] = []
afterEach(async () => { await Promise.all(applications.splice(0).map((app) => app.close())) })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function setup() {
  let now = 1000; let next = 1
  const tasks = new Map<string, Task>()
  const store: TasksStore = {
    list: vi.fn(async () => ({ tasks: [...tasks.values()], nextCursor: null })),
    counts: vi.fn(async () => { const total = tasks.size, completed = [...tasks.values()].filter(task => task.completed).length; return { total, completed, pending: total - completed } }), get: async (id) => tasks.get(id),
    create: vi.fn(async (title) => { const task = { id: String(next++), title, completed: false }; tasks.set(task.id, task); return task }),
    update: async (id, completed) => { const previous = tasks.get(id); if (!previous) return; const task = { ...previous, completed }; tasks.set(id, task); return task },
    delete: async (id) => tasks.delete(id),
  }
  const records: unknown[] = []
  const memory = new MemoryCacheStore<TaskSummary>({ clock: () => now })
  const cache = new Cache(memory, { ttlMs: 1000 })
  const app = createApp(defaultConfig, createLogger({ sink: (record) => records.push(record) }), store)
  app.container.override(provide(TaskSummaryCache, { factory: () => cache }))
  applications.push(app)
  const request = (path: string, method = 'GET', value?: unknown) => app.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }))
  const summary = async () => {
    const response = await request('/summary')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return (await response.json()).summary
  }
  return { app, store, memory, cache, records, request, summary, advance: (value: number) => { now += value } }
}

it('caches summary reads, expires them, and invalidates each successful local mutation', async () => {
  const { store, summary, request, advance } = setup()
  const first = await summary()
  expect(first).toMatchObject({ total: 0, completed: 0, pending: 0 })
  expect(await summary()).toEqual(first)
  expect(store.counts).toHaveBeenCalledTimes(1)
  expect(store.list).not.toHaveBeenCalled()
  advance(1000); await summary()
  expect(store.counts).toHaveBeenCalledTimes(2)
  const created = await request('/tasks', 'POST', { title: 'one' })
  const id = (await created.json()).task.id
  expect(await summary()).toMatchObject({ total: 1, completed: 0, pending: 1 })
  await request(`/tasks/${id}`, 'PATCH', { completed: true })
  expect(await summary()).toMatchObject({ total: 1, completed: 1, pending: 0 })
  await request(`/tasks/${id}`, 'DELETE')
  expect(await summary()).toMatchObject({ total: 0, completed: 0, pending: 0 })
  const before = vi.mocked(store.counts).mock.calls.length
  await request(`/tasks/${id}`, 'DELETE')
  await request('/tasks', 'POST', { title: '' })
  await summary()
  expect(store.counts).toHaveBeenCalledTimes(before)
})

it('does not wait for or retain an older summary loader when a write invalidates it', async () => {
  const { store, summary, request } = setup()
  const entered = deferred(); const gate = deferred()
  const original = store.counts
  vi.mocked(store.counts).mockImplementationOnce(async () => { const old = await original(); entered.resolve(); await gate.promise; return old })
  const old = summary()
  await entered.promise
  expect((await request('/tasks', 'POST', { title: 'after read began' })).status).toBe(201)
  expect(await summary()).toMatchObject({ total: 1 })
  gate.resolve()
  expect(await old).toMatchObject({ total: 0 })
  expect(await summary()).toMatchObject({ total: 1 })
})

it('preserves committed writes and bypasses a cache whose invalidation failed', async () => {
  const { memory, request, summary, records } = setup()
  expect(await summary()).toMatchObject({ total: 0 })
  const secret = 'provider error containing private data'
  vi.spyOn(memory, 'delete').mockRejectedValue(new Error(secret))
  expect((await request('/tasks', 'POST', { title: 'saved' })).status).toBe(201)
  expect(await summary()).toMatchObject({ total: 1 })
  expect(JSON.stringify(records)).toContain('Task summary cache bypassed')
  expect(JSON.stringify(records)).not.toContain(secret)
})

it('retries failed source reads without misclassifying them as cache-provider failures', async () => {
  const { store, request, summary, records } = setup()
  vi.mocked(store.counts).mockRejectedValueOnce(new Error('source unavailable'))
  expect((await request('/summary')).status).toBe(500)
  expect(await summary()).toMatchObject({ total: 0 })
  expect(store.counts).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(records)).not.toContain('Task summary cache bypassed')
})

it('keeps cache usable for draining events, then drains loaders before releasing SQLite', async () => {
  const app = configureSqliteStorage(createApp(), ':memory:')
  applications.push(app); await app.start()
  const cache = app.container.resolve(TaskSummaryCache)
  const events = app.container.resolve(TaskEvents)
  const database = app.container.resolve(TaskDatabase)
  const entered = deferred(); const gate = deferred(); const eventEntered = deferred(); const eventGate = deferred()
  const snapshot = { total: 0, completed: 0, pending: 0, generatedAt: new Date().toISOString() }
  const loading = cache.getOrLoad('external', async () => { entered.resolve(); await gate.promise; await database.execute('SELECT 1'); return snapshot })
  await entered.promise
  const Check = defineEvent<void>('cache.check')
  events.on(Check, async () => { eventEntered.resolve(); await eventGate.promise; expect(cache.state).toBe('open'); await cache.get('missing') })
  const emission = events.emit(Check, undefined)
  await eventEntered.promise
  const closing = app.close()
  eventGate.resolve(); await emission
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(cache.state).toBe('closing')
  expect((await database.execute('SELECT 1')).rows).toHaveLength(1)
  gate.resolve(); expect(await loading).toEqual(snapshot); await closing
  expect(cache.state).toBe('closed')
  await expect(database.execute('SELECT 1')).rejects.toThrow('closed')
})
