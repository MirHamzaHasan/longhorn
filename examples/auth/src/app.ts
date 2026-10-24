import { AuthError, AuthService } from '@longhorn/auth'
import type { PasswordHasher } from '@longhorn/auth'
import { cookieAuth } from '@longhorn/auth/hono'
import type { AuthEnv } from '@longhorn/auth/hono'
import { authMigrations, SqliteAuthStore } from '@longhorn/auth/sqlite'
import { Longhorn } from '@longhorn/core'
import type { LonghornEnv } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import { migrate } from '@longhorn/database'
import type { Database } from '@longhorn/database'
import type { Logger } from '@longhorn/logger'
import { validate } from '@longhorn/validation/hono'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import { listNotes, noteListQuery } from './notes.js'

type Env = LonghornEnv & AuthEnv
const Auth = token<AuthService>('authentication')
const Connection = token<Database>('auth example database')
const credentials = z.object({ username: z.string().min(3).max(64), password: z.string().min(1).max(256) }).strict()
const registration = credentials.extend({ password: z.string().min(15).max(256) })
const passwordChange = z.object({ currentPassword: z.string().min(1).max(256), nextPassword: z.string().min(15).max(256) }).strict()
const note = z.object({ title: z.string().trim().min(1).max(200) }).strict()

function failure(c: Context<Env>, error: unknown): Response {
  if (!(error instanceof AuthError)) throw error
  if (error.code === 'RATE_LIMITED') c.header('Retry-After', String(Math.ceil((error.retryAfterMs ?? 1000) / 1000)))
  const status = { INVALID_INPUT: 400, USERNAME_TAKEN: 409, INVALID_CREDENTIALS: 401, RATE_LIMITED: 429, CAPACITY: 503 } as const
  return c.json({ error: error.message }, status[error.code])
}

export function createAuthApp(config: AppConfig, resources: {
  openDatabase: () => Promise<Database>; passwords: PasswordHasher; logger?: Logger; clock?: () => number
}): Longhorn {
  const app = new Longhorn(resources.logger ? { logger: resources.logger } : {})
  app.onStart(async () => {
    const database = await resources.openDatabase()
    try {
      await migrate(database, [...authMigrations, { id: 'auth_example/001_notes', statements: [
        `CREATE TABLE private_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL REFERENCES longhorn_auth_users(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200)
        ) STRICT`,
        'CREATE INDEX private_notes_owner ON private_notes(owner_id)',
      ] }])
      app.container.register(provide(Connection, { factory: () => database }))
      app.container.register(provide(Auth, { deps: [Connection], factory: (connection) => new AuthService(
        new SqliteAuthStore(connection), resources.passwords, {
          sessionTtlMs: config.sessionTtlMs, passwordChanges: true, sessionControls: true, ...(resources.clock ? { clock: resources.clock } : {}),
        },
      ) }))
      return () => database.close()
    } catch (error) {
      try { await database.close() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Authentication startup and cleanup failed', { cause: error })
      }
      throw error
    }
  })
  const routes = new Hono<Env>()
  const auth = cookieAuth<Env>({ origin: config.origin, secure: config.secure,
    resolve: (c) => c.get('container').resolve(Auth) })
  routes.use('*', auth.middleware)
  routes.use('*', bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'Request body too large' }, 413) }))
  routes.get('/health', (c) => c.json({ status: 'ok' }))
  routes.post('/auth/register', validate('json', registration), async (c) => {
    const body = c.req.valid('json')
    try { return c.json({ user: await c.get('container').resolve(Auth).register(body.username, body.password) }, 201) }
    catch (error) { return failure(c, error) }
  })
  routes.post('/auth/login', validate('json', credentials), async (c) => {
    const body = c.req.valid('json')
    try {
      const result = await c.get('container').resolve(Auth).login(body.username, body.password, auth.token(c))
      auth.setSession(c, result.session)
      return c.json({ user: result.user, session: { expiresAt: result.session.expiresAt } })
    } catch (error) { return failure(c, error) }
  })
  routes.get('/auth/session', auth.requireUser, (c) => c.json(c.get('auth')!))
  routes.post('/auth/logout', async (c) => {
    await c.get('container').resolve(Auth).logout(auth.token(c))
    auth.clearSession(c)
    return c.body(null, 204)
  })
  routes.post('/auth/logout-all', auth.requireUser, async (c) => {
    try { await c.get('container').resolve(Auth).revokeSessions(auth.token(c), 'all'); auth.clearSession(c); return c.body(null, 204) }
    catch (error) { return failure(c, error) }
  })
  routes.post('/auth/sessions/revoke', auth.requireUser, validate('json', z.object({ scope: z.enum(['others', 'all']) }).strict()), async c => {
    try {
      const scope = c.req.valid('json').scope, result = await c.get('container').resolve(Auth).revokeSessions(auth.token(c), scope)
      if (scope === 'all') auth.clearSession(c)
      return c.json(result)
    } catch (error) { return failure(c, error) }
  })
  routes.get('/admin', auth.requireRole('admin'), (c) => c.json({ allowed: true }))
  routes.post('/auth/password', auth.requireUser, validate('json', passwordChange), async c => {
    const input = c.req.valid('json')
    try {
      await c.get('container').resolve(Auth).changePassword(auth.token(c), input.currentPassword, input.nextPassword)
      auth.clearSession(c); return c.body(null, 204)
    } catch (error) { return failure(c, error) }
  })
  routes.get('/notes', auth.requireUser, async (c, next) => {
    if (Object.values(c.req.queries()).some(values => values.length !== 1)) return c.json({ error: 'Invalid note query' }, 400)
    await next()
  }, validate('query', noteListQuery), async (c) => c.json(await listNotes(c.get('container').resolve(Connection), c.get('auth')!.user.id, c.req.valid('query'))))
  routes.post('/notes', auth.requireUser, validate('json', note), async (c) => {
    const row = (await c.get('container').resolve(Connection).execute({
      sql: 'INSERT INTO private_notes (owner_id, title) VALUES (?, ?) RETURNING id, title',
      args: [c.get('auth')!.user.id, c.req.valid('json').title],
    })).rows[0]!
    return c.json({ note: { id: String(row.id), title: row.title } }, 201)
  })
  routes.delete('/notes/:id', auth.requireUser, async (c) => {
    const result = await c.get('container').resolve(Connection).execute({
      sql: 'DELETE FROM private_notes WHERE id = ? AND owner_id = ?', args: [c.req.param('id'), c.get('auth')!.user.id],
    })
    return result.rowsAffected ? c.body(null, 204) : c.json({ error: 'Note not found' }, 404)
  })
  app.http.route('/', routes)
  return app
}
