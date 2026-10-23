import { Longhorn } from '../../packages/core/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { Idempotency } from '../../packages/idempotency/dist/index.js'
import { SqliteIdempotencyStore,idempotencyMigrations } from '../../packages/idempotency/dist/sqlite.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { SqliteQueueStore,queueMigrations } from '../../packages/queue/dist/sqlite.js'
import { schedulerMigrations } from '../../packages/scheduler/dist/sqlite.js'
import { enqueueInTransaction } from '../../packages/queue/dist/transaction.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { createSqliteAlarmClock,alarmClockMigrations } from '../../runtimes/workers/dist/sqlite-alarms.js'

export class IdempotencyFixture{
  constructor(state,env){
    this.state=state;this.boot=crypto.randomUUID();this.time=2500000000000
    const storage=state.storage,original=storage.setAlarm
    storage.setAlarm=async time=>{await original.call(storage,time);if(this.fault==='abort'){this.fault=undefined;state.abort('owned idempotent precommit interruption')}}
    const app=this.app=new Longhorn(),database=this.database=createDurableSqlite(state),now=()=>env.LIVE?Date.now():this.time
    const schema={'~standard':{version:1,vendor:'idempotent-object',validate:value=>({value})}}
    this.queue=new Queue({name:'idempotent.object.v1',schema,store:new SqliteQueueStore(database),now})
    this.requests=new Idempotency({store:new SqliteIdempotencyStore(database),now,retentionMs:env.LIVE?86400000:100})
    this.clock=createSqliteAlarmClock(state,{database,application:app,queues:[this.queue.name],now,minDelayMs:25,timeoutMs:5000,handle:async({limit})=>{
      for(let i=0;i<limit;i++){
        const result=await this.queue.runOnce(async(data,job)=>{
          const business=(await database.execute({sql:'SELECT title FROM idempotent_business WHERE id=?',args:[data.id]})).rows[0]
          if(!business)throw new Error('Idempotent consumer cannot find committed business')
          await database.execute({sql:'INSERT INTO idempotent_effects(job_id,title) VALUES(?,?) ON CONFLICT(job_id) DO NOTHING',args:[job.id,business.title]})
        })
        if(result.status==='idle')break
        if(result.status!=='succeeded')throw new Error('Idempotent consumer failed')
      }
    }})
    app.onStart(async()=>{await migrate(database,[...queueMigrations,...schedulerMigrations,...alarmClockMigrations,...idempotencyMigrations,{id:'idempotent_fixture/001',statements:[
      'CREATE TABLE idempotent_business(id TEXT PRIMARY KEY,title TEXT NOT NULL) STRICT',
      'CREATE TABLE idempotent_effects(job_id TEXT PRIMARY KEY,title TEXT NOT NULL) STRICT',
    ]}]);return()=>database.close()})
    app.onStart(async()=>{await this.clock.start();return()=>this.clock.close()});app.onStart(()=>()=>this.queue.close())
  }
  alarm(info){return this.clock.alarm(info)}
  async fetch(request){
    const path=new URL(request.url).pathname
    if(path==='/persisted')return Response.json({boot:this.boot,alarm:await this.state.storage.getAlarm(),business:this.state.storage.sql.exec('SELECT * FROM idempotent_business').toArray(),jobs:this.state.storage.sql.exec('SELECT id,state FROM longhorn_queue_jobs').toArray(),records:this.state.storage.sql.exec('SELECT scope,request_key,result,expires_at FROM longhorn_idempotency_requests').toArray(),effects:this.state.storage.sql.exec('SELECT * FROM idempotent_effects').toArray()})
    await this.app.start()
    const data=request.method==='POST'?await request.json():{}
    if(path==='/time'){this.time=data.now;return Response.json({ok:true})}
    if(path==='/prune')return Response.json({removed:await this.requests.prune(data.limit??100)})
    if(path==='/publish'){
      this.fault=data.fault
      try{
        const result=await this.requests.run({scope:data.scope??'object:tasks:v1',key:data.key,input:{title:data.title??'saved'}},async tx=>{
          const id=crypto.randomUUID();await tx.execute({sql:'INSERT INTO idempotent_business VALUES(?,?)',args:[id,data.title??'saved']})
          const job=await enqueueInTransaction(this.queue,tx,{id})
          if(data.failure)throw new Error('owned idempotent business failure')
          return{id,job}
        })
        if(data.loseResponse)this.state.abort('owned interruption after idempotent commit')
        return Response.json(result)
      }catch(error){return Response.json({error:error.name},{status:error.name==='IdempotencyConflictError'?409:500})}
    }
    return new Response('missing',{status:404})
  }
}
export default{fetch(request,env){return env.STORE.get(env.STORE.idFromName('idempotency')).fetch(request)}}
