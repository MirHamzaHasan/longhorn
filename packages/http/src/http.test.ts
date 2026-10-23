import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpApp, HTTPException } from './index.js'

afterEach(() => vi.restoreAllMocks())

describe('HTTP defaults', () => {
  it('formats message-only HTTP exceptions as JSON', async () => {
    const app = createHttpApp()
    app.get('/invalid', () => { throw new HTTPException(400, { message: 'Invalid request' }) })
    const response = await app.request('/invalid')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request' })
  })

  it('returns JSON for unmatched routes', async () => {
    const response = await createHttpApp().request('/missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  it('preserves intentional HTTP errors and their headers', async () => {
    const app = createHttpApp()
    app.get('/private', () => {
      throw new HTTPException(401, {
        res: new Response('Sign in', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }),
      })
    })
    const response = await app.request('/private')
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(await response.text()).toBe('Sign in')
  })

  it('logs unexpected async errors without disclosing them to clients', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createHttpApp()
    const error = new Error('secret database connection string')
    app.get('/failure', async () => { throw error })
    const response = await app.request('/failure')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
    expect(log).toHaveBeenCalledWith(error)
  })

  it('allows applications to replace the default error handler', async () => {
    const app = createHttpApp()
    app.onError((_error, c) => c.json({ error: 'Try again' }, 503))
    app.get('/failure', () => { throw new Error('offline') })
    const response = await app.request('/failure')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Try again' })
  })
})
