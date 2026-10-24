import { AuthError,AuthService } from '@longhorn/auth'
import type { PasswordHasher } from '@longhorn/auth'
import { cookieAuth } from '@longhorn/auth/hono'
import type { AuthEnv } from '@longhorn/auth/hono'
import { PostgresAuthStore } from '@longhorn/auth/postgres'
import { checkPostgresPasswordFunctions } from '@longhorn/auth/postgres-passwords'
import type { Longhorn,LonghornEnv } from '@longhorn/core'
import { provide,token } from '@longhorn/container'
import type { Token } from '@longhorn/container'
import type { Database } from '@longhorn/database'
import { validate } from '@longhorn/validation/hono'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { PostgresPrivateNotes,privateNoteParams,privateNoteQuery,privateNoteSchema } from './private-notes.js'

export const PgAuthStore=token<PostgresAuthStore>('PostgreSQL account store')
export const PgAccounts=token<AuthService>('PostgreSQL account service')
export const PgPrivateNotes=token<PostgresPrivateNotes>('PostgreSQL private notes')
export type AccountOptions={ readonly origin: string;readonly secure: boolean;readonly sessionTtlMs: number;readonly passwords: PasswordHasher;readonly clock?: () => number;readonly passwordChanges?: boolean }
type Env=LonghornEnv & AuthEnv
const credentials=z.object({ username: z.string().min(3).max(64),password: z.string().min(1).max(256) }).strict()
const registration=credentials.extend({ password: z.string().min(15).max(256) })
const passwordChange=z.object({currentPassword:z.string().min(1).max(256),nextPassword:z.string().min(15).max(256)}).strict()
function failure(c: Context<Env>,error: unknown): Response {
  if (!(error instanceof AuthError)) throw error
  if (error.code==='RATE_LIMITED') c.header('Retry-After',String(Math.ceil((error.retryAfterMs ?? 1000)/1000)))
  const statuses={ INVALID_INPUT: 400,USERNAME_TAKEN: 409,INVALID_CREDENTIALS: 401,RATE_LIMITED: 429,CAPACITY: 503 } as const
  return c.json({ error: error.message },statuses[error.code])
}
export async function checkAccountTables(database: Database,passwordChanges=false): Promise<void> {
  await database.execute('SELECT id FROM longhorn_auth.users LIMIT 0')
  await database.execute('SELECT token_hash FROM longhorn_auth.sessions LIMIT 0')
  await database.execute('SELECT key FROM longhorn_auth.attempts LIMIT 0')
  await database.execute('SELECT id FROM longhorn_pg_example.private_notes LIMIT 0')
  if(passwordChanges)await checkPostgresPasswordFunctions(database)
}
export function configurePostgresAccounts(app: Longhorn,databaseToken: Token<Database>,options: AccountOptions) {
  app.container.register(provide(PgAuthStore,{ deps: [databaseToken],factory: database => new PostgresAuthStore(database) }))
  app.container.register(provide(PgAccounts,{ deps: [PgAuthStore],factory: store => new AuthService(store,options.passwords,{
    sessionTtlMs: options.sessionTtlMs,passwordChanges:options.passwordChanges??false,...(options.clock ? { clock: options.clock } : {}),
  }) }))
  app.container.register(provide(PgPrivateNotes,{ deps: [databaseToken],factory: database => new PostgresPrivateNotes(database) }))
  app.onStart(() => { app.container.resolve(PgAccounts) })
  const routes=new Hono<Env>()
  const auth=cookieAuth<Env>({ origin: options.origin,secure: options.secure,resolve: c => c.get('container').resolve(PgAccounts) })
  routes.use('*',auth.middleware)
  routes.post('/register',validate('json',registration),async c => {
    const body=c.req.valid('json')
    try { return c.json({ user: await c.get('container').resolve(PgAccounts).register(body.username,body.password) },201) }
    catch (error) { return failure(c,error) }
  })
  routes.post('/login',validate('json',credentials),async c => {
    const body=c.req.valid('json')
    try {
      const result=await c.get('container').resolve(PgAccounts).login(body.username,body.password,auth.token(c))
      auth.setSession(c,result.session);return c.json({ user: result.user,session: { expiresAt: result.session.expiresAt } })
    } catch (error) { return failure(c,error) }
  })
  routes.get('/session',auth.requireUser,c => c.json(c.get('auth')!))
  routes.post('/logout',async c => { await c.get('container').resolve(PgAccounts).logout(auth.token(c));auth.clearSession(c);return c.body(null,204) })
  routes.post('/logout-all',auth.requireUser,async c => { await c.get('container').resolve(PgAccounts).revokeAll(c.get('auth')!.user.id);auth.clearSession(c);return c.body(null,204) })
  routes.get('/admin',auth.requireRole('admin'),c => c.json({ allowed: true }))
  if(options.passwordChanges)routes.post('/password',auth.requireUser,validate('json',passwordChange),async c=>{
    const input=c.req.valid('json')
    try{await c.get('container').resolve(PgAccounts).changePassword(auth.token(c),input.currentPassword,input.nextPassword);auth.clearSession(c);return c.body(null,204)}
    catch(error){return failure(c,error)}
  })
  routes.get('/notes',auth.requireUser,validate('query',privateNoteQuery),async c => c.json(await c.get('container').resolve(PgPrivateNotes).list(c.get('auth')!.user.id,c.req.valid('query'))))
  routes.get('/notes/:id',auth.requireUser,validate('param',privateNoteParams),async c => {
    const note=await c.get('container').resolve(PgPrivateNotes).get(c.get('auth')!.user.id,c.req.valid('param').id)
    return note ? c.json({ note }) : c.json({ error: 'Note not found' },404)
  })
  routes.post('/notes',auth.requireUser,validate('json',privateNoteSchema),async c => {
    const note=await c.get('container').resolve(PgPrivateNotes).create(c.get('auth')!.user.id,c.req.valid('json').title)
    c.header('Location',`/account/notes/${note.id}`);return c.json({ note },201)
  })
  routes.delete('/notes/:id',auth.requireUser,validate('param',privateNoteParams),async c => await c.get('container').resolve(PgPrivateNotes).delete(c.get('auth')!.user.id,c.req.valid('param').id)
    ? c.body(null,204) : c.json({ error: 'Note not found' },404))
  // Prefix the whole sub-app so auth middleware does not apply to public task/report routes.
  app.http.route('/account',routes)
  return auth
}
