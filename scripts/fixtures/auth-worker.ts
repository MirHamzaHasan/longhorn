// Portability fixture only. Password security is verified separately with native
// scrypt. This in-memory test store and test hasher are never production exports.
import { Hono } from '../../packages/http/dist/index.js'
import { AuthService } from '../../packages/auth/dist/index.js'
import { cookieAuth } from '../../packages/auth/dist/hono.js'
import type { AuthEnv } from '../../packages/auth/dist/hono.js'
import { MemoryAuthStore, testPasswords } from '../../packages/auth/src/test-support.js'

const service = new AuthService(new MemoryAuthStore(), testPasswords)
const cookies = cookieAuth<AuthEnv>({ origin: 'https://auth.example', resolve: () => service })
const app = new Hono<AuthEnv>()
app.use('*', cookies.middleware)
app.post('/register', async (c) => {
  const input = await c.req.json<{ username: string; password: string }>()
  return c.json(await service.register(input.username, input.password), 201)
})
app.post('/login', async (c) => {
  const input = await c.req.json<{ username: string; password: string }>()
  const result = await service.login(input.username, input.password, cookies.token(c))
  cookies.setSession(c, result.session)
  return c.json({ user: result.user })
})
app.get('/private', cookies.requireUser, (c) => c.json(c.get('auth')!))
app.post('/logout', async (c) => { await service.logout(cookies.token(c)); cookies.clearSession(c); return c.body(null, 204) })
export default app
