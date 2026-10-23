import { expect, it, vi } from 'vitest'
import { provide, token } from '@longhorn/container'
import { Hono } from '@longhorn/http'
import type { RuntimeAdapter, ServerHandle } from '@longhorn/runtime'
import { Longhorn } from './application.js'

it('shares application services with handlers through the Hono context', async () => {
  const Counter = token<{ value: number }>('counter')
  const app = new Longhorn()
  app.container.register(provide(Counter, { factory: () => ({ value: 0 }) }))
  app.http.get('/counter', (c) => {
    const counter = c.get('container').resolve(Counter)
    return c.json({ value: ++counter.value })
  })

  expect(await (await app.http.request('/counter')).json()).toEqual({ value: 1 })
  expect(await (await app.http.request('/counter')).json()).toEqual({ value: 2 })
  expect(app.container.resolve(Counter).value).toBe(2)
})

it('isolates services between application instances', async () => {
  const Value = token<string>('value')
  const a = new Longhorn()
  const b = new Longhorn()
  a.container.register(provide(Value, { factory: () => 'a' }))
  b.container.register(provide(Value, { factory: () => 'b' }))
  for (const app of [a, b]) {
    app.http.get('/', (c) => c.text(c.get('container').resolve(Value)))
  }
  expect(await (await a.http.request('/')).text()).toBe('a')
  expect(await (await b.http.request('/')).text()).toBe('b')
})

it('keeps native Hono routers and middleware usable', async () => {
  const app = new Longhorn()
  const routes = new Hono()
  routes.get('/hello/:name', (c) => c.json({ hello: c.req.param('name') }))
  app.http.use('/api/*', async (c, next) => {
    await next()
    c.header('X-Longhorn-Test', 'middleware')
  })
  app.http.route('/api', routes)

  const response = await app.http.request('/api/hello/LongHorn')
  expect(response.headers.get('X-Longhorn-Test')).toBe('middleware')
  expect(await response.json()).toEqual({ hello: 'LongHorn' })
})

it('exposes a detached Fetch handler with typed runtime bindings', async () => {
  const app = new Longhorn<{ GREETING: string }>()
  app.http.get('/', (c) => c.text(c.env.GREETING))
  const fetch = app.fetch
  const response = await fetch(new Request('http://localhost/'), { GREETING: 'Hello' })
  expect(await response.text()).toBe('Hello')
})

it('delegates listening to an injected adapter', async () => {
  const app = new Longhorn()
  const handle: ServerHandle = {
    hostname: '127.0.0.1', port: 1234, url: 'http://127.0.0.1:1234',
    close: async () => {},
  }
  const serve = vi.fn<RuntimeAdapter['serve']>().mockResolvedValue(handle)
  const adapter: RuntimeAdapter = { name: 'test', serve }
  expect(await app.listen(adapter, { port: 1234 })).toBe(handle)
  expect(serve).toHaveBeenCalledWith(app, { port: 1234 })
})
