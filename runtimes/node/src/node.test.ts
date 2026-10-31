import { afterEach, expect, it } from 'vitest'
import type { ServerHandle } from '@longhornjs/runtime'
import { serve } from './index.js'

const servers: ServerHandle[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

it('serves Web Standard requests over a real ephemeral TCP port', async () => {
  const server = await serve({
    async fetch(request) {
      return Response.json({ method: request.method, body: await request.json() }, {
        status: 201, headers: { 'X-Adapter': 'node' },
      })
    },
  }, { port: 0 })
  servers.push(server)

  expect(server.port).toBeGreaterThan(0)
  const response = await fetch(`${server.url}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'LongHorn works' }),
  })
  expect(response.status).toBe(201)
  expect(response.headers.get('X-Adapter')).toBe('node')
  expect(await response.json()).toEqual({ method: 'POST', body: { message: 'LongHorn works' } })
})

it('rejects startup when the requested port is occupied', async () => {
  const application = { fetch: () => new Response('ok') }
  const server = await serve(application, { port: 0 })
  servers.push(server)
  await expect(serve(application, { port: server.port })).rejects.toMatchObject({ code: 'EADDRINUSE' })
})

it('rejects invalid ports', async () => {
  await expect(serve({ fetch: () => new Response('ok') }, { port: -1 })).rejects.toThrow()
})

it('closes idempotently and releases its port', async () => {
  const application = { fetch: () => new Response('ok') }
  const server = await serve(application, { port: 0 })
  await Promise.all([server.close(), server.close()])
  const replacement = await serve(application, { port: server.port })
  servers.push(replacement)
  expect(await (await fetch(replacement.url)).text()).toBe('ok')
})
