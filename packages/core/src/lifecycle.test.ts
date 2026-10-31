import { expect, it, vi } from 'vitest'
import type { RuntimeAdapter, ServerHandle } from '@longhornjs/runtime'
import { Longhorn } from './application.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function handle(close: () => Promise<void> = async () => {}): ServerHandle {
  return { hostname: '127.0.0.1', port: 3000, url: 'http://127.0.0.1:3000', close }
}

it('starts once across concurrent callers and rejects late hook registration', async () => {
  const gate = deferred<void>()
  const hook = vi.fn(async () => { await gate.promise })
  const app = new Longhorn().onStart(hook)
  const first = app.start()
  expect(app.start()).toBe(first)
  expect(app.state).toBe('starting')
  expect(() => app.onStart(() => {})).toThrow(/before/)
  expect(() => app.onStop(() => {})).toThrow(/before/)
  gate.resolve()
  await first
  expect(app.state).toBe('running')
  expect(hook).toHaveBeenCalledTimes(1)
  await app.close()
  expect(app.state).toBe('stopped')
  await expect(app.start()).rejects.toThrow(/closed/)
})

it('starts Fetch applications lazily and preserves bound handlers', async () => {
  const app = new Longhorn()
  let ready = false
  app.onStart(() => { ready = true })
  app.http.get('/', (c) => c.json({ ready }))
  const fetch = app.fetch
  expect(await (await fetch(new Request('http://localhost/'))).json()).toEqual({ ready: true })
  await app.close()
  await expect(fetch(new Request('http://localhost/'))).rejects.toThrow(/closed/)
})

it('closes listeners before resources, then runs stop hooks in reverse order', async () => {
  const events: string[] = []
  const app = new Longhorn()
    .onStart(() => { events.push('open db'); return () => { events.push('close db') } })
    .onStart(() => { events.push('open worker'); return () => { events.push('close worker') } })
    .onStop(() => { events.push('stop first') })
    .onStop(() => { events.push('stop last') })
  const adapter: RuntimeAdapter = {
    name: 'test', serve: async () => {
      events.push('listen')
      return handle(async () => { events.push('close listener') })
    },
  }
  await app.listen(adapter)
  const first = app.close()
  expect(app.close()).toBe(first)
  await first
  expect(events).toEqual([
    'open db', 'open worker', 'listen', 'close listener', 'close worker', 'close db', 'stop last', 'stop first',
  ])
})

it('rolls back only acquired resources when a startup hook fails', async () => {
  const events: string[] = []
  const error = new Error('Cannot connect')
  const app = new Longhorn()
    .onStart(() => () => { events.push('release acquired resource') })
    .onStart(() => { throw error })
    .onStart(() => { events.push('should never start') })
    .onStop(() => { events.push('stopped') })
  const serve = vi.fn<RuntimeAdapter['serve']>()
  await expect(app.listen({ name: 'test', serve })).rejects.toBe(error)
  expect(serve).not.toHaveBeenCalled()
  expect(events).toEqual(['release acquired resource', 'stopped'])
  expect(app.state).toBe('failed')
  await app.close()
  expect(events).toHaveLength(2)
})

it('reports startup and rollback failures together while attempting every cleanup', async () => {
  const startError = new Error('start failed')
  const cleanupError = new Error('cleanup failed')
  const stopped = vi.fn()
  const app = new Longhorn()
    .onStart(() => () => { throw cleanupError })
    .onStart(() => { throw startError })
    .onStop(stopped)
  await expect(app.start()).rejects.toMatchObject({
    errors: [startError, cleanupError], cause: startError,
  })
  expect(stopped).toHaveBeenCalledTimes(1)
})

it('releases resources after a failed server bind', async () => {
  const cleanup = vi.fn()
  const app = new Longhorn().onStart(() => cleanup)
  const error = new Error('Port busy')
  await expect(app.listen({ name: 'test', serve: async () => { throw error } })).rejects.toBe(error)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(app.state).toBe('stopped')
})

it('continues cleaning resources after listener and stop hook failures', async () => {
  const events: string[] = []
  const app = new Longhorn()
    .onStart(() => () => { events.push('released') })
    .onStop(() => { events.push('stop hook'); throw new Error('stop failed') })
  await app.listen({ name: 'test', serve: async () => handle(async () => { throw new Error('socket close failed') }) })
  const closing = app.close()
  await expect(closing).rejects.toBeInstanceOf(AggregateError)
  expect(events).toEqual(['released', 'stop hook'])
  expect(app.close()).toBe(closing)
  expect(app.state).toBe('stopped')
})

it('waits for startup before cleaning up when close races with startup', async () => {
  const gate = deferred<void>()
  const released = vi.fn()
  const app = new Longhorn().onStart(async () => { await gate.promise; return released })
  const serve = vi.fn<RuntimeAdapter['serve']>().mockResolvedValue(handle())
  const listening = app.listen({ name: 'test', serve })
  const rejected = expect(listening).rejects.toThrow(/closing/)
  const closing = app.close()
  gate.resolve()
  await rejected
  await closing
  expect(serve).not.toHaveBeenCalled()
  expect(released).toHaveBeenCalledTimes(1)
})

it('closes a listener that finishes opening during shutdown', async () => {
  const ready = deferred<void>()
  const opening = deferred<ServerHandle>()
  const close = vi.fn(async () => {})
  const released = vi.fn()
  const app = new Longhorn().onStart(() => released)
  const listening = app.listen({ name: 'test', serve: () => { ready.resolve(); return opening.promise } })
  await ready.promise
  const rejected = expect(listening).rejects.toThrow(/closed/)
  const closing = app.close()
  opening.resolve(handle(close))
  await rejected
  await closing
  expect(close).toHaveBeenCalledTimes(1)
  expect(released).toHaveBeenCalledTimes(1)
})

it('keeps an existing listener running when an additional listener fails to bind', async () => {
  const cleanup = vi.fn()
  const close = vi.fn(async () => {})
  const app = new Longhorn().onStart(() => cleanup)
  await app.listen({ name: 'first', serve: async () => handle(close) })
  await expect(app.listen({ name: 'second', serve: async () => { throw new Error('busy') } })).rejects.toThrow('busy')
  expect(app.state).toBe('running')
  expect(cleanup).not.toHaveBeenCalled()
  await app.close()
  expect(close).toHaveBeenCalledTimes(1)
  expect(cleanup).toHaveBeenCalledTimes(1)
})

it('rejects hook registration once closing begins, even before startup', async () => {
  const app = new Longhorn()
  const closing = app.close()
  expect(() => app.onStart(() => {})).toThrow(/before/)
  expect(() => app.onStop(() => {})).toThrow(/before/)
  await closing
})

it('drains direct Fetch handlers before releasing resources without a listener', async () => {
  const entered = deferred<void>()
  const gate = deferred<void>()
  const released = vi.fn()
  const app = new Longhorn().onStart(() => released)
  app.http.get('/', async (c) => {
    entered.resolve()
    await gate.promise
    return c.json({ released: released.mock.calls.length > 0 })
  })
  const request = app.fetch(new Request('http://localhost/'))
  await entered.promise
  const closing = app.close()
  await Promise.resolve()
  expect(released).not.toHaveBeenCalled()
  gate.resolve()
  expect(await (await request).json()).toEqual({ released: false })
  await closing
  expect(released).toHaveBeenCalledTimes(1)
})

it('prevents a queued Fetch dispatch when shutdown begins during startup', async () => {
  const gate = deferred<void>()
  const app = new Longhorn().onStart(async () => { await gate.promise })
  const handler = vi.fn((c: { text: (value: string) => Response }) => c.text('unexpected'))
  app.http.get('/', handler)
  const request = app.fetch(new Request('http://localhost/'))
  const rejected = expect(request).rejects.toThrow(/closing/)
  const closing = app.close()
  gate.resolve()
  await rejected
  await closing
  expect(handler).not.toHaveBeenCalled()
})
