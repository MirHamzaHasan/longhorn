import { expect, it, vi } from 'vitest'
import { Longhorn } from '@longhornjs/core'
import { createWorker } from './index.js'
import type { WorkerExecutionContext } from './index.js'

function context(): WorkerExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }
}

it('forwards the original request, bindings, and context without losing method ownership', async () => {
  const request = new Request('https://worker.example/')
  const bindings = { GREETING: 'hello' }
  const ctx = context()
  const application = {
    label: 'application',
    fetch(input: Request, env?: typeof bindings | {}, execution?: WorkerExecutionContext) {
      expect(this.label).toBe('application')
      expect(input).toBe(request)
      expect(env).toBe(bindings)
      expect(execution).toBe(ctx)
      return new Response('ok')
    },
  }
  expect(await (await createWorker(application).fetch(request, bindings, ctx)).text()).toBe('ok')
})

it('keeps per-request bindings isolated across concurrent dispatch', async () => {
  const app = new Longhorn<{ GREETING: string }>()
  app.http.get('/', async (c) => {
    const before = c.env.GREETING
    await Promise.resolve()
    return c.json({ before, after: c.env.GREETING })
  })
  const worker = createWorker<{ GREETING: string }>(app)
  const [a, b] = await Promise.all([
    worker.fetch(new Request('https://worker.example/'), { GREETING: 'one' }, context()),
    worker.fetch(new Request('https://worker.example/'), { GREETING: 'two' }, context()),
  ])
  expect(await a.json()).toEqual({ before: 'one', after: 'one' })
  expect(await b.json()).toEqual({ before: 'two', after: 'two' })
  expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'))
  await app.close()
})

it('preserves waitUntil and starts a shared application only once', async () => {
  const start = vi.fn()
  const stop = vi.fn()
  const app = new Longhorn().onStart(() => { start(); return stop })
  const ctx = context()
  const pending = Promise.resolve()
  app.http.get('/', (c) => {
    c.executionCtx.waitUntil(pending)
    return c.json({ ready: true })
  })
  const worker = createWorker(app)
  await worker.fetch(new Request('https://worker.example/'), {}, ctx)
  await worker.fetch(new Request('https://worker.example/'), {}, ctx)
  expect(start).toHaveBeenCalledTimes(1)
  expect(stop).not.toHaveBeenCalled()
  expect(ctx.waitUntil).toHaveBeenCalledWith(pending)
  expect(app.state).toBe('running')
  await app.close()
  expect(stop).toHaveBeenCalledTimes(1)
})

it('leaves host-level rejected Fetch handlers available to platform error policy', async () => {
  const error = new Error('host policy')
  const worker = createWorker({ fetch: async () => { throw error } })
  await expect(worker.fetch(new Request('https://worker.example/'), {}, context())).rejects.toBe(error)
})
