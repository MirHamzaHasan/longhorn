import { configureHistoryViews } from './history-views-http.js'
import { checkHistoryViewTable } from './history-view-migrations.js'
import type { AuthEnv } from '@longhorn/auth/hono'
import type { Longhorn, LonghornEnv } from '@longhorn/core'
import { provide, token } from '@longhorn/container'
import type { Token } from '@longhorn/container'
import type { Database } from '@longhorn/database'
import { Idempotency, IdempotencyConflictError } from '@longhorn/idempotency'
import { PostgresIdempotencyStore } from '@longhorn/idempotency/postgres'
import { Outbox } from '@longhorn/outbox'
import type { MessagePublisher } from '@longhorn/outbox'
import { createOutboxOperations } from '@longhorn/outbox/hono'
import { PostgresOutboxStore } from '@longhorn/outbox/postgres'
import { validate } from '@longhorn/validation/hono'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { PgAccounts } from './accounts.js'
import type { configurePostgresAccounts } from './accounts.js'
import { commandSchema, operationData, operationTopic, operatorRole } from './operation-contracts.js'
import type { OperationData } from './operation-contracts.js'
import { checkHistoryFilterIndexes } from './history-filter-migrations.js'
import { checkHistorySearchIndexes } from './history-search-migrations.js'
import { PostgresCommandHistory,commandHistoryQuery,CommandHistoryCursorError } from './command-history.js'

type Env = LonghornEnv & AuthEnv
type AccountAccess = ReturnType<typeof configurePostgresAccounts>
export type AccountOperationsOptions = {
  readonly publisher?: MessagePublisher<OperationData>
  readonly readReceipt?: (id: string,signal: AbortSignal) => Promise<Response>
  readonly checkHealth?: (signal: AbortSignal) => Promise<boolean>
}
export const PgOperationOutbox = token<Outbox<OperationData>>('account command outgoing messages')
const Requests = token<Idempotency>('account command request replay')
export const PgCommandHistory=token<PostgresCommandHistory>('account command history')
const params = z.object({ id: z.uuid() })
export async function checkOperationTables(database: Database): Promise<void> {
  await database.execute('SELECT id,history_id,created_at,delivery_id FROM longhorn_pg_example.operator_commands LIMIT 0')
  await database.execute('SELECT id FROM longhorn_outbox.recovery_audit LIMIT 0')
  const permission = (await database.execute("SELECT has_function_privilege(current_user,'longhorn_auth.lock_session_user(text)','EXECUTE') AS allowed")).rows[0]
  if (permission?.allowed !== true) throw new Error('Account operations require the transaction authentication grant')
  await checkHistoryFilterIndexes(database)
  await checkHistorySearchIndexes(database)
  await checkHistoryViewTable(database)
}
export function configurePostgresOperations(app: Longhorn, dbToken: Token<Database>, access: AccountAccess, options: AccountOperationsOptions): void {
  app.container.register(provide(PgOperationOutbox, { deps: [dbToken], factory: db => new Outbox({ name: operationTopic,schema: operationData,store: new PostgresOutboxStore(db),retryDelayMs: 100,maxRetryDelayMs: 1000,leaseMs: 1000 }) }))
  app.container.register(provide(Requests, { deps: [dbToken], factory: db => new Idempotency({ store: new PostgresIdempotencyStore(db) }) }))
  app.container.register(provide(PgCommandHistory,{deps:[dbToken],factory:db=>new PostgresCommandHistory(db)}))
  app.onStart(() => { const outgoing = app.container.resolve(PgOperationOutbox); return () => outgoing.close() })
  if (options.publisher) app.onStart(() => { const worker = app.container.resolve(PgOperationOutbox).createDispatcher(options.publisher!, { pollIntervalMs: 25 }); worker.start(); return () => worker.close() })
  configureHistoryViews(app,dbToken,access)
  const principal = (c: Context<Env>) => c.get('auth')?.user
  const authorize = (c: Context<Env>) => {
    const user = principal(c)
    if (!user) return c.json({ error: 'Authentication required' },401)
    if (!user.roles.includes(operatorRole)) return c.json({ error: 'Forbidden' },403)
    return { actor: 'user:'+user.id }
  }
  app.http.route('/account/operations', createOutboxOperations<OperationData,Env>({
    resolve: c => c.get('container').resolve(PgOperationOutbox), authorize,
    authorizeRetry: async (c, tx) => {
      const current = await c.get('container').resolve(PgAccounts).authenticateInTransaction(tx, access.token(c))
      if (!current) throw new HTTPException(401,{ message: 'Authentication required' })
      if (!current.user.roles.includes(operatorRole)) throw new HTTPException(403,{ message: 'Forbidden' })
      return { actor: 'user:'+current.user.id }
    }, location: id => '/account/operations/deliveries/'+id,
  }))
  const commands = new Hono<Env>()
  commands.use('*',access.requireUser)
  commands.get('/',async(c,next)=>{
    const query=c.req.queries()
    if(query.scope?.includes('all')&&!principal(c)!.roles.includes(operatorRole))return c.json({error:'Forbidden'},403)
    if(Object.values(query).some(values=>values.length!==1))return c.json({error:'Duplicate history query parameter'},400)
    await next()
  },validate('query',commandHistoryQuery),async c=>{
    const input=c.req.valid('query'),actor=principal(c)!
    if(input.scope==='all'&&!actor.roles.includes(operatorRole))return c.json({error:'Forbidden'},403)
    try{return c.json(await c.get('container').resolve(PgCommandHistory).list(actor.id,input))}
    catch(error){if(error instanceof CommandHistoryCursorError)return c.json({error:error.message},400);throw error}
  })
  commands.post('/',validate('json',commandSchema),async c => {
    const input = c.req.valid('json'), actor = principal(c)!, container = c.get('container')
    try {
      const outcome = await container.resolve(Requests).run({ scope: 'user:'+actor.id+':numbers-command:v1',key: input.id,input },async tx => {
        const current = await container.resolve(PgAccounts).authenticateInTransaction(tx,access.token(c))
        if (!current || current.user.id!==actor.id) throw new HTTPException(401,{ message: 'Authentication required' })
        const id = crypto.randomUUID()
        const delivery = await container.resolve(PgOperationOutbox).enqueueInTransaction(tx,{commandId:id,numbers:input.numbers})
        await container.resolve(PgCommandHistory).insertIn(tx,{id,ownerId:actor.id,numbers:input.numbers,deliveryId:delivery.id,createdAt:delivery.createdAt})
        return { command: { id,numbers:input.numbers },delivery }
      })
      c.header('Location','/account/commands/'+outcome.value.command.id); c.header('Idempotency-Replayed',String(outcome.replayed))
      return c.json(outcome.value,201)
    } catch (error) { if (error instanceof IdempotencyConflictError) return c.json({error:'Request key was already used with different input'},409); throw error }
  })
  const owned = async (c: Context<Env>, id: string) => {
    const actor = principal(c)!
    return (await c.get('container').resolve(dbToken).execute({sql:'SELECT id,numbers FROM longhorn_pg_example.operator_commands WHERE id=$1 AND (owner_id=$2 OR $3::boolean)',args:[id,actor.id,actor.roles.includes(operatorRole)]})).rows[0]
  }
  commands.get('/:id',validate('param',params),async c => {
    const actor=principal(c)!,row=await c.get('container').resolve(PgCommandHistory).get(actor.id,c.req.valid('param').id,actor.roles.includes(operatorRole)?'all':'mine')
    return row?c.json(row):c.json({error:'Command not found'},404)
  })
  commands.get('/:id/receipt',validate('param',params),async c => {
    const row = await owned(c,c.req.valid('param').id)
    if (!row) return c.json({error:'Command not found'},404)
    return options.readReceipt ? options.readReceipt(String(row.id),c.req.raw.signal) : c.json({error:'Receipt reader is not configured'},503)
  })
  app.http.route('/account/commands',commands)
}
