import type { AuthEnv } from '@longhornjs/auth/hono'
import type { Longhorn,LonghornEnv } from '@longhornjs/core'
import { provide,token } from '@longhornjs/container'
import type { Token } from '@longhornjs/container'
import type { Database,SqlExecutor } from '@longhornjs/database'
import { Idempotency,IdempotencyConflictError } from '@longhornjs/idempotency'
import { PostgresIdempotencyStore } from '@longhornjs/idempotency/postgres'
import { validate } from '@longhornjs/validation/hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { PgAccounts } from './accounts.js'
import type { configurePostgresAccounts } from './accounts.js'
import { operatorRole } from './operation-contracts.js'
import { normalizeSavedSelection,normalizeViewName } from './history-view-values.js'
import type { SavedViewSelection } from './history-view-values.js'
import { HistoryViewError,PostgresHistoryViews } from './history-views.js'

type Env=LonghornEnv & AuthEnv
export const PgHistoryViews=token<PostgresHistoryViews>('account saved history views')
const Requests=token<Idempotency>('saved history view request replay')
const name=z.string().transform((value,ctx)=>{try{return normalizeViewName(value)}catch(error){ctx.addIssue({code:'custom',message:(error as Error).message});return z.NEVER}})
const selection=z.unknown().transform((value,ctx)=>{try{return normalizeSavedSelection(value)}catch(error){ctx.addIssue({code:'custom',message:(error as Error).message});return z.NEVER}})
const uuid=z.uuid().transform(value=>value.toLowerCase()),params=z.object({id:uuid}).strict(),revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const create=z.object({id:uuid,name,selection}).strict(),update=z.object({requestId:uuid,expectedRevision:revision,name,selection}).strict(),remove=z.object({requestId:uuid,expectedRevision:revision}).strict()
export function configureHistoryViews(app:Longhorn,database:Token<Database>,access:ReturnType<typeof configurePostgresAccounts>):void{
  app.container.register(provide(PgHistoryViews,{deps:[database],factory:db=>new PostgresHistoryViews(db)}))
  app.container.register(provide(Requests,{deps:[database],factory:db=>new Idempotency({store:new PostgresIdempotencyStore(db)})}))
  const router=new Hono<Env>();router.use('*',access.requireUser)
  router.get('/',validate('query',z.object({}).strict()),async c=>c.json({views:await c.get('container').resolve(PgHistoryViews).list(c.get('auth')!.user.id)}))
  router.get('/:id',validate('param',params),async c=>{const view=await c.get('container').resolve(PgHistoryViews).get(c.get('auth')!.user.id,c.req.valid('param').id);return view?c.json({view}):c.json({error:'Saved view not found'},404)})
  router.onError((error,c)=>{if(error instanceof HistoryViewError)return c.json({error:error.message},error.status);if(error instanceof IdempotencyConflictError)return c.json({error:'This request key was already used. Refresh views and try again.'},409);throw error})
  const authorize=async(c:Parameters<typeof access.token>[0],tx:SqlExecutor,owner:string,view?:SavedViewSelection)=>{
    const principal=await c.get('container').resolve(PgAccounts).authenticateInTransaction(tx,access.token(c))
    if(!principal||principal.user.id!==owner)throw new HistoryViewError(401,'Authentication required')
    if(view?.scope==='all'&&!principal.user.roles.includes(operatorRole))throw new HistoryViewError(403,'This view needs operator access.')
  }
  router.post('/',validate('json',create),async c=>{
    const input=c.req.valid('json'),owner=c.get('auth')!.user.id,container=c.get('container')
    if(input.selection.scope==='all'&&!c.get('auth')!.user.roles.includes(operatorRole))return c.json({error:'This view needs operator access.'},403)
    const result=await container.resolve(Requests).run({scope:'user:'+owner+':history-view:create:v1',key:input.id,input},async tx=>{await authorize(c,tx,owner,input.selection);return container.resolve(PgHistoryViews).createIn(tx,owner,input.id,input.name,input.selection)})
    c.header('Location','/account/history-views/'+result.value.id);c.header('Idempotency-Replayed',String(result.replayed));return c.json({view:result.value},201)
  })
  router.put('/:id',validate('param',params),validate('json',update),async c=>{
    const input=c.req.valid('json'),id=c.req.valid('param').id,owner=c.get('auth')!.user.id,container=c.get('container')
    if(input.selection.scope==='all'&&!c.get('auth')!.user.roles.includes(operatorRole))return c.json({error:'This view needs operator access.'},403)
    const result=await container.resolve(Requests).run({scope:'user:'+owner+':history-view:update:v1:'+id,key:input.requestId,input},async tx=>{await authorize(c,tx,owner,input.selection);return container.resolve(PgHistoryViews).updateIn(tx,owner,id,input.expectedRevision,input.name,input.selection)})
    c.header('Idempotency-Replayed',String(result.replayed));return c.json({view:result.value})
  })
  router.delete('/:id',validate('param',params),validate('json',remove),async c=>{
    const input=c.req.valid('json'),id=c.req.valid('param').id,owner=c.get('auth')!.user.id,container=c.get('container')
    const result=await container.resolve(Requests).run({scope:'user:'+owner+':history-view:delete:v1:'+id,key:input.requestId,input},async tx=>{await authorize(c,tx,owner);return container.resolve(PgHistoryViews).deleteIn(tx,owner,id,input.expectedRevision)})
    c.header('Idempotency-Replayed',String(result.replayed));return c.body(null,204)
  })
  app.http.route('/account/history-views',router)
}
