import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context, Env, MiddlewareHandler } from 'hono'
import type { AuthService } from './credentials.js'
import type { Authenticated, AuthUser, IssuedSession } from './types.js'

export type AuthEnv = { Variables: { auth: Authenticated | undefined } }
type CookieAuthOptions<E extends Env> = {
  resolve: (context: Context<E>) => AuthService | Promise<AuthService>
  origin: string
  /** Default true. Explicit false is permitted only for a loopback HTTP origin. */
  secure?: boolean
}
export function cookieAuth<E extends AuthEnv>(options: CookieAuthOptions<E>) {
  const url = new URL(options.origin)
  const origin = url.origin
  const secure = options.secure ?? true
  if (options.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Authentication origin must be an exact HTTP(S) origin without path, query, or credentials')
  }
  if (secure ? url.protocol !== 'https:' : url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Secure cookies require HTTPS; insecure development cookies require an explicit loopback HTTP origin')
  }
  const name = secure ? '__Host-id' : 'longhorn_dev'
  const settings = { httpOnly: true, secure, sameSite: 'Strict' as const, path: '/' }
  function token(c: Context<E>): string | undefined {
    const matches = (c.req.header('Cookie') ?? '').split(';').filter((part) => part.trim().split('=')[0] === name)
    return matches.length > 1 ? undefined : getCookie(c, name)
  }
  const middleware: MiddlewareHandler<E> = async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Vary', 'Cookie', { append: true })
    c.set('auth', undefined)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('Origin') !== origin || c.req.header('Sec-Fetch-Site') === 'cross-site') {
        return c.json({ error: 'Untrusted request origin' }, 403)
      }
    }
    const value = token(c)
    const auth = value ? await (await options.resolve(c)).authenticate(value) : undefined
    c.set('auth', auth)
    if (value && !auth) deleteCookie(c, name, settings)
    await next()
    c.header('Cache-Control', 'no-store')
  }
  const requireUser: MiddlewareHandler<E> = async (c, next) => {
    if (!c.get('auth')) return c.json({ error: 'Authentication required' }, 401)
    await next()
  }
  function authorize(policy: (user: AuthUser, context: Context<E>) => boolean | Promise<boolean>): MiddlewareHandler<E> {
    return async (c, next) => {
      const auth = c.get('auth')
      if (!auth) return c.json({ error: 'Authentication required' }, 401)
      if (!await policy(auth.user, c)) return c.json({ error: 'Forbidden' }, 403)
      await next()
    }
  }
  return {
    middleware, requireUser, authorize, token,
    requireRole: (role: string) => authorize((user) => user.roles.includes(role)),
    setSession(c: Context<E>, session: IssuedSession) {
      setCookie(c, name, session.token, { ...settings, expires: new Date(session.expiresAt) })
    },
    clearSession(c: Context<E>) { deleteCookie(c, name, settings) },
  }
}
