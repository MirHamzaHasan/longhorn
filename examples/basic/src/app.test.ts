import { expect, it } from 'vitest'
import { nodeRuntime } from '@longhornjs/node'
import { createTestApp as createApp } from './test-support.js'

it('runs the tasks workflow through LongHorn and a real Node server', async () => {
  const app = createApp()
  const server = await app.listen(nodeRuntime, { port: 0 })
  try {
    const request = (path: string, init?: RequestInit) => fetch(`${server.url}${path}`, init)
    expect(await (await request('/health')).json()).toEqual({ status: 'ok' })
    expect(await (await request('/tasks')).json()).toEqual({ tasks: [], nextCursor: null })

    const created = await request('/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  Build with LongHorn  ' }),
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('Location')).toBe('/tasks/1')
    const task = { id: '1', title: 'Build with LongHorn', completed: false }
    expect(await created.json()).toEqual({ task })
    expect(await (await request('/tasks/1')).json()).toEqual({ task })
    expect(await (await request('/tasks')).json()).toEqual({ tasks: [task], nextCursor: null })

    const updated = await request('/tasks/1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ task: { ...task, completed: true } })

    const removed = await request('/tasks/1', { method: 'DELETE' })
    expect(removed.status).toBe(204)
    expect(await removed.text()).toBe('')
    expect((await request('/tasks/1')).status).toBe(404)
    expect(await (await request('/tasks')).json()).toEqual({ tasks: [], nextCursor: null })
  } finally {
    await app.close()
  }
})

it.each([
  ['malformed JSON', '{'],
  ['null', 'null'],
  ['array', '[]'],
  ['missing title', '{}'],
  ['non-string title', '{"title":12}'],
  ['blank title', '{"title":"   "}'],
  ['long title', JSON.stringify({ title: 'a'.repeat(201) })],
])('rejects %s without creating a task', async (_label, body) => {
  const app = createApp()
  const response = await app.http.request('/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toHaveProperty('error')
  expect(await (await app.http.request('/tasks')).json()).toEqual({ tasks: [], nextCursor: null })
})

it('rejects invalid updates without changing the stored task', async () => {
  const app = createApp()
  await app.http.request('/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Keep this task' }),
  })
  const response = await app.http.request('/tasks/1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: 'true' }),
  })
  expect(response.status).toBe(400)
  expect(await (await app.http.request('/tasks/1')).json()).toEqual({
    task: { id: '1', title: 'Keep this task', completed: false },
  })
})

it.each(['GET', 'PATCH', 'DELETE'])('returns 404 for %s of a missing task', async (method) => {
  const response = await createApp().http.request('/tasks/missing', {
    method,
    ...(method === 'PATCH' ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    } : {}),
  })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Task not found' })
})

it('uses the framework JSON fallback for unknown paths', async () => {
  const response = await createApp().http.request('/missing')
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not Found' })
})

it('rejects malformed, duplicate and unknown list parameters', async () => {
  const app = createApp()
  try {
    for (const query of ['limit=0', 'limit=101', 'limit=01', 'limit=1e2', 'limit=', 'after=0', 'after=-1', 'after=01',
      'after=9223372036854775808', 'after=1%20OR%201=1', 'completed=1', 'completed=True', 'unknown=1',
      'limit=1&limit=2', 'after=1&after=2', 'completed=true&completed=false']) {
      const response = await app.fetch(new Request('http://localhost/tasks?' + query))
      expect(response.status).toBe(400)
    }
    const response = await app.fetch(new Request('http://localhost/tasks?limit=100&after=9223372036854775807&completed=false'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ tasks: [], nextCursor: null })
  } finally { await app.close() }
})
