import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'
import { createHttpApp, HTTPException } from '@longhorn/http'
import { z } from 'zod'
import type { StandardSchemaV1 } from './index.js'
import { validate } from './hono.js'

afterEach(() => vi.restoreAllMocks())

it('exposes typed, transformed JSON to handlers', async () => {
  const app = createHttpApp()
  app.post('/', validate('json', z.object({ count: z.string().transform(Number) })), (c) => {
    const body = c.req.valid('json')
    expectTypeOf(body).toEqualTypeOf<{ count: number }>()
    return c.json(body)
  })
  const response = await app.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"count":"12"}',
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ count: 12 })
})

it('reports field errors and stops execution before the handler', async () => {
  const called = vi.fn()
  const app = createHttpApp()
  app.post('/', validate('json', z.object({ title: z.string().min(1, 'Title is required') })), (c) => {
    called()
    return c.text('unexpected')
  })
  const response = await app.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":""}',
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    error: 'Validation failed', target: 'json',
    issues: [{ path: ['title'], message: 'Title is required' }],
  })
  expect(called).not.toHaveBeenCalled()
})

it('preserves Hono query parsing, including repeated keys and defaults', async () => {
  const app = createHttpApp()
  app.get('/', validate('query', z.object({
    page: z.coerce.number().int().positive().default(1), tags: z.array(z.string()),
  })), (c) => {
    const query = c.req.valid('query')
    expectTypeOf(query).toEqualTypeOf<{ page: number; tags: string[] }>()
    return c.json(query)
  })
  expect(await (await app.request('/?tags=one&tags=two')).json()).toEqual({ page: 1, tags: ['one', 'two'] })
  const invalid = await app.request('/?page=-1&tags=one&tags=two')
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ target: 'query', issues: [{ path: ['page'] }] })
})

it('validates and transforms route parameters', async () => {
  const app = createHttpApp()
  app.get('/tasks/:id', validate('param', z.object({ id: z.coerce.number().int().positive() })), (c) => {
    expectTypeOf(c.req.valid('param').id).toEqualTypeOf<number>()
    return c.json(c.req.valid('param'))
  })
  expect(await (await app.request('/tasks/12')).json()).toEqual({ id: 12 })
  expect((await app.request('/tasks/nope')).status).toBe(400)
})

it('composes parameter and JSON validators without overwriting validated data', async () => {
  const app = createHttpApp()
  app.patch('/tasks/:id',
    validate('param', z.object({ id: z.string() })),
    validate('json', z.object({ completed: z.boolean() })),
    (c) => c.json({ ...c.req.valid('param'), ...c.req.valid('json') }),
  )
  const response = await app.request('/tasks/1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"completed":true}',
  })
  expect(await response.json()).toEqual({ id: '1', completed: true })
})

it('supports forms, headers, and cookies through Hono targets', async () => {
  const app = createHttpApp()
  app.post('/',
    validate('form', z.object({ name: z.string().trim() })),
    validate('header', z.object({ 'x-token': z.string() })),
    validate('cookie', z.object({ session: z.string() })),
    (c) => c.json({
      ...c.req.valid('form'), ...c.req.valid('header'), ...c.req.valid('cookie'),
    }),
  )
  const form = new FormData()
  form.set('name', ' LongHorn ')
  const response = await app.request('/', {
    method: 'POST', body: form, headers: { 'x-token': 'abc', Cookie: 'session=demo' },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ name: 'LongHorn', 'x-token': 'abc', session: 'demo' })
})

it('awaits asynchronous schema validation', async () => {
  const app = createHttpApp()
  app.get('/', validate('query', z.object({
    name: z.string().refine(async (name) => name !== 'taken', 'Already taken'),
  })), (c) => c.json(c.req.valid('query')))
  expect((await app.request('/?name=taken')).status).toBe(400)
  expect(await (await app.request('/?name=available')).json()).toEqual({ name: 'available' })
})

it('returns the framework JSON error for malformed request JSON', async () => {
  const app = createHttpApp()
  app.post('/', validate('json', z.object({ title: z.string() })), (c) => c.json(c.req.valid('json')))
  const response = await app.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Malformed JSON in request body' })
})

it('follows Hono JSON media type rules', async () => {
  const app = createHttpApp()
  app.post('/', validate('json', z.object({ title: z.string() })), (c) => c.json(c.req.valid('json')))
  for (const contentType of ['application/json; charset=utf-8', 'application/vnd.api+json']) {
    const response = await app.request('/', {
      method: 'POST', headers: { 'Content-Type': contentType }, body: '{"title":"Hello"}',
    })
    expect(await response.json()).toEqual({ title: 'Hello' })
  }
  const response = await app.request('/', { method: 'POST', body: '{"title":"Hello"}' })
  expect(response.status).toBe(400)
})

it('does not include raw input or extra vendor issue data in the error response', async () => {
  const vendorIssue = { message: 'Invalid field', path: [{ key: 'password' }], input: 'secret' }
  const schema: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [vendorIssue] }) },
  }
  const app = createHttpApp()
  app.get('/', validate('query', schema), (c) => c.text('unexpected'))
  const response = await app.request('/?password=secret')
  expect(await response.json()).toEqual({
    error: 'Validation failed', target: 'query', issues: [{ message: 'Invalid field', path: ['password'] }],
  })
})

it('keeps programmer errors as 500 responses', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const schema: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: () => { throw new Error('broken validator') } },
  }
  const app = createHttpApp()
  app.get('/', validate('query', schema), (c) => c.text('unexpected'))
  const response = await app.request('/')
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Internal Server Error' })
})

it('preserves intentional errors from downstream handlers', async () => {
  const app = createHttpApp()
  app.get('/', validate('query', z.object({})), () => {
    throw new HTTPException(403, { res: new Response('Forbidden', { status: 403 }) })
  })
  const response = await app.request('/')
  expect(response.status).toBe(403)
  expect(await response.text()).toBe('Forbidden')
})
