import { expect, it } from 'vitest'
import { Hono } from 'hono'
import { AuthService } from './credentials.js'
import { cookieAuth } from './hono.js'
import type { AuthEnv } from './hono.js'
import { MemoryAuthStore, testPasswords } from './test-support.js'

function setup(origin = 'https://auth.example', secure = true) {
  const store = new MemoryAuthStore()
  const service = new AuthService(store, testPasswords)
  const cookies = cookieAuth<AuthEnv>({ origin, secure, resolve: () => service })
  const app = new Hono<AuthEnv>()
  app.onError((error, c) => c.json({ error: 'Internal Server Error' }, 500))
  app.use('*', cookies.middleware)
  app.get('/private', cookies.requireUser, (c) => c.json(c.get('auth')))
  app.post('/write', (c) => c.json({ ok: true }))
  app.get('/role', cookies.requireRole('admin'), (c) => c.json({ ok: true }))
  app.get('/policy', cookies.authorize(async (user) => user.username === 'person'), (c) => c.json({ ok: true }))
  app.get('/failed-policy', cookies.authorize(async () => { throw new Error('policy unavailable') }), (c) => c.json({ allowed: true }))
  app.get('/cookie', async (c) => { cookies.setSession(c, await service.sessions.create('person')); return c.json({ ok: true }) })
  return { app, cookies, service, store }
}

it('requires secure origins by default and confines insecure cookies to explicit HTTP loopback', () => {
  for (const origin of ['http://auth.example', 'https://auth.example/', 'https://auth.example/path', 'https://u:p@auth.example']) {
    expect(() => setup(origin)).toThrow()
  }
  expect(() => setup('http://remote.example', false)).toThrow('loopback')
  expect(() => setup('http://127.0.0.1:3001', false)).not.toThrow()
  expect(() => setup('http://[::1]:3001', false)).not.toThrow()
})

it('writes host-bound secure cookies with HttpOnly, Strict, expiry, and no Domain', async () => {
  const { app } = setup()
  const response = await app.request('/cookie')
  const cookie = response.headers.get('Set-Cookie')!
  for (const value of ['__Host-id=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Expires=']) expect(cookie).toContain(value)
  expect(cookie).not.toContain('Domain=')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Vary')).toContain('Cookie')
})

it('rejects missing, null, cross-origin, and cross-site writes for every content type', async () => {
  const { app } = setup()
  for (const origin of ['', 'null', 'https://other.example', 'https://auth.example.evil']) {
    for (const contentType of ['application/json', 'text/plain', 'application/x-www-form-urlencoded']) {
      expect((await app.request('/write', { method: 'POST', headers: { Origin: origin, 'Content-Type': contentType } })).status).toBe(403)
    }
  }
  expect((await app.request('/write', { method: 'POST', headers: { Origin: 'https://auth.example', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
  expect((await app.request('/write', { method: 'POST', headers: { Origin: 'https://auth.example' } })).status).toBe(200)
  for (const method of ['PUT', 'PATCH', 'DELETE']) expect((await app.request('/write', { method })).status).toBe(403)
})

it('authenticates only one unambiguous cookie and applies role and asynchronous policy checks', async () => {
  const { app, service, store } = setup()
  const user = await service.register('person', 'a long passphrase here')
  const { session } = await service.login('person', 'a long passphrase here')
  const cookie = `__Host-id=${session.token}`
  expect((await app.request('/private')).status).toBe(401)
  expect((await app.request('/private', { headers: { Authorization: `Bearer ${session.token}` } })).status).toBe(401)
  expect((await app.request(`/private?token=${session.token}`)).status).toBe(401)
  expect((await app.request('/private', { headers: { Cookie: `${cookie}; ${cookie}` } })).status).toBe(401)
  expect((await app.request('/private', { headers: { Cookie: cookie } })).status).toBe(200)
  expect((await app.request('/role', { headers: { Cookie: cookie } })).status).toBe(403)
  expect((await app.request('/policy', { headers: { Cookie: cookie } })).status).toBe(200)
  expect((await app.request('/failed-policy', { headers: { Cookie: cookie } })).status).toBe(500)
  store.users.set(user.id, { ...store.users.get(user.id)!, roles: ['admin'] })
  expect((await app.request('/role', { headers: { Cookie: cookie } })).status).toBe(200)
})

it('clears a revoked cookie and returns no cached principal', async () => {
  const { app, service } = setup()
  await service.register('person', 'a long passphrase here')
  const { session } = await service.login('person', 'a long passphrase here')
  await service.logout(session.token)
  const response = await app.request('/private', { headers: { Cookie: `__Host-id=${session.token}` } })
  expect(response.status).toBe(401)
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})
