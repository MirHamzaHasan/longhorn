import{configureTaskCreateLimits}from'./request-limits.js'
import{Longhorn}from'@longhornjs/core'
import{provide,token}from'@longhornjs/container'
import type{BatchDatabase}from'@longhornjs/database'
import{verifySqliteBatchMigrations,BatchMigrationError}from'@longhornjs/database/batch'
import{createD1,D1Error}from'@longhornjs/workers/d1'
import{IdempotencyConflictError,IdempotencyInputError,validIdempotencyKey}from'@longhornjs/idempotency'
import{BatchIdempotency,BatchIdempotencyError}from'@longhornjs/idempotency/batch-sqlite'
import type{D1Binding}from'@longhornjs/workers/d1'
import{validate}from'@longhornjs/validation/hono'
import{bodyLimit}from'hono/body-limit'
import{HTTPException}from'hono/http-exception'
import{migrations}from'./schema.js'
import{D1TasksStore}from'./tasks.js'
import{createSchema,updateSchema,deleteSchema,idSchema,pageSchema}from'./config.js'
import type{D1Config}from'./config.js'
export const TaskDatabase=token<BatchDatabase>('D1 task database'),Tasks=token<D1TasksStore>('D1 task store')
export const TaskRequests=token<BatchIdempotency>('D1 task requests')
export function createD1TasksApp(binding:D1Binding,config:D1Config):Longhorn{
  const app=new Longhorn(),database=createD1(binding,{maxPending:config.maxPending})
  app.onStart(async()=>{
    try{
      await verifySqliteBatchMigrations(database,migrations)
      await database.batch(['SELECT id,title,completed,revision,created_at,updated_at,mutation,position FROM d1_tasks LIMIT 0','SELECT task_id,revision,kind,at,mutation,position FROM d1_task_activity LIMIT 0','SELECT scope,request_key,fingerprint,claim,result,expires_at FROM longhorn_batch_idempotency_requests LIMIT 0'])
      if(config.createLimits)await database.execute('SELECT scope,subject_hash,policy_limit,window_ms,attempts,expires_at,observed_at FROM longhorn_batch_rate_limit_buckets LIMIT 0')
      app.container.register(provide(TaskDatabase,{factory:()=>database}));return()=>database.close()
    }catch(error){await database.close();throw error}
  })
  app.container.register(provide(TaskRequests,{deps:[TaskDatabase],factory:db=>new BatchIdempotency({database:db,retentionMs:config.retentionMs})}))
  app.container.register(provide(Tasks,{deps:[TaskDatabase,TaskRequests] as const,factory:(db,requests)=>new D1TasksStore(db,requests)}))
  app.http.use('*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'Request body too large'},413)}))
  app.http.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
  app.http.onError((error,c)=>{
    if(error instanceof HTTPException)return error.res?error.getResponse():c.json({error:'Invalid request'},error.status)
    if(error instanceof IdempotencyInputError)return c.json({error:'Invalid idempotency request'},400)
    if(error instanceof IdempotencyConflictError)return c.json({error:'Idempotency key already used with different input'},409)
    const unavailable=error instanceof D1Error||error instanceof BatchMigrationError||error instanceof BatchIdempotencyError
    return c.json({error:unavailable?'D1 operation unavailable':'Internal server error'},unavailable?503:500)
  })
  app.http.get('/',c=>c.json({framework:'LongHorn',storage:'d1',endpoints:['/health','/tasks','/tasks/:id','/activity','/tasks/:id/activity']}))
  app.http.get('/health',c=>c.json({status:'ok',storage:'d1',schema:migrations.at(-1)!.id}))
  app.http.get('/tasks',validate('query',pageSchema),async c=>{const page=c.req.valid('query');return c.json(await app.container.resolve(Tasks).list(page.after,page.limit))})
  const createBudget=configureTaskCreateLimits(app,TaskDatabase,config.createLimits)
  app.http.post('/tasks',createBudget,validate('json',createSchema),async c=>{
    const title=c.req.valid('json').title,key=c.req.header('Idempotency-Key'),tasks=app.container.resolve(Tasks)
    if(key!==undefined&&!validIdempotencyKey(key))return c.json({error:'Invalid idempotency key'},400)
    let task
    if(key!==undefined){const result=await tasks.createIdempotent(title,key);task=result.value;c.header('Idempotency-Replayed',String(result.replayed));c.header('Idempotency-Expires-At',String(result.expiresAt))}
    else task=await tasks.create(title)
    c.header('Location','/tasks/'+task.id);return c.json({task},201)
  })
  app.http.get('/tasks/:id',validate('param',idSchema),async c=>{const task=await app.container.resolve(Tasks).get(c.req.valid('param').id);return task?c.json({task}):c.json({error:'Task not found'},404)})
  app.http.patch('/tasks/:id',validate('param',idSchema),validate('json',updateSchema),async c=>{
    const result=await app.container.resolve(Tasks).update(c.req.valid('param').id,c.req.valid('json'))
    if(result.status==='updated')return c.json({task:result.task})
    return result.status==='missing'?c.json({error:'Task not found'},404):c.json({error:'Task revision changed',currentRevision:result.currentRevision},409)
  })
  app.http.delete('/tasks/:id',validate('param',idSchema),validate('json',deleteSchema),async c=>{
    const result=await app.container.resolve(Tasks).delete(c.req.valid('param').id,c.req.valid('json').revision)
    if(result.status==='deleted')return c.body(null,204)
    return result.status==='missing'?c.json({error:'Task not found'},404):c.json({error:'Task revision changed',currentRevision:result.currentRevision},409)
  })
  app.http.get('/activity',validate('query',pageSchema),async c=>{const page=c.req.valid('query');return c.json(await app.container.resolve(Tasks).activity(page.after,page.limit))})
  app.http.get('/tasks/:id/activity',validate('param',idSchema),validate('query',pageSchema),async c=>{const page=c.req.valid('query');return c.json(await app.container.resolve(Tasks).activity(page.after,page.limit,c.req.valid('param').id))})
  return app
}
