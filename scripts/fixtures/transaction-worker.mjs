import { Longhorn } from '../../packages/core/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { isTransactionExecutor } from '../../packages/database/dist/transactions.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { SqliteQueueStore,queueMigrations } from '../../packages/queue/dist/sqlite.js'
import { schedulerMigrations } from '../../packages/scheduler/dist/sqlite.js'
import { enqueueInTransaction } from '../../packages/queue/dist/transaction.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { createSqliteAlarmClock,alarmClockMigrations } from '../../runtimes/workers/dist/sqlite-alarms.js'

export class TransactionFixture{
  constructor(state,env){
    this.state=state;this.env=env;this.boot=crypto.randomUUID();this.fault=undefined
    const storage=state.storage,original=storage.setAlarm
    storage.setAlarm=async time=>{await original.call(storage,time);if(this.fault==='throw'){this.fault=undefined;throw new Error('owned failure after alarm write')}if(this.fault==='abort'){this.fault=undefined;state.abort('owned atomic publishing interruption')}}
    const app=this.app=new Longhorn(),database=this.database=createDurableSqlite(state),now=()=>env.LIVE?Date.now():2500000000000
    const schema={'~standard':{version:1,vendor:'atomic-native',validate:async value=>{
      if(value.businessId==='slow')await fetch(env.GATE_URL+'/schema')
      return typeof value.businessId==='string'&&value.businessId?{value}:{issues:[{message:'business ID required'}]}
    }}}
    this.queue=new Queue({name:'atomic.worker.v1',schema,store:new SqliteQueueStore(database),now})
    this.clock=createSqliteAlarmClock(state,{database,application:app,queues:['atomic.worker.v1'],now,minDelayMs:25,timeoutMs:5000,handle:async({signal,limit})=>{
      for(let i=0;i<limit;i++){
        signal.throwIfAborted()
        const result=await this.queue.runOnce(async(data,job)=>{
          const business=(await database.execute({sql:'SELECT title FROM atomic_business WHERE id=?',args:[data.businessId]})).rows[0]
          if(!business)throw new Error('Published job cannot find its business row')
          await database.execute({sql:'INSERT INTO atomic_effects(job_id,title) VALUES(?,?) ON CONFLICT(job_id) DO NOTHING',args:[job.id,business.title]})
        })
        if(result.status==='idle')break
        if(result.status!=='succeeded')throw new Error('Atomic worker job failed')
      }
    }})
    app.onStart(async()=>{await migrate(database,[...queueMigrations,...schedulerMigrations,...alarmClockMigrations,{id:'atomic_fixture/001',statements:[
      'CREATE TABLE atomic_business(id TEXT PRIMARY KEY,title TEXT NOT NULL) STRICT',
      'CREATE TABLE atomic_effects(job_id TEXT PRIMARY KEY,title TEXT NOT NULL) STRICT',
    ]}]);return()=>database.close()})
    app.onStart(async()=>{await this.clock.start();return()=>this.clock.close()});app.onStart(()=>()=>this.queue.close())
  }
  alarm(info){return this.clock.alarm(info)}
  async fetch(request){
    const path=new URL(request.url).pathname
    if(path==='/persisted')return Response.json({boot:this.boot,alarm:await this.state.storage.getAlarm(),business:this.state.storage.sql.exec('SELECT * FROM atomic_business ORDER BY id').toArray(),jobs:this.state.storage.sql.exec('SELECT id,state FROM longhorn_queue_jobs ORDER BY id').toArray()})
    await this.app.start()
    const data=request.method==='POST'?await request.json():{}
    if(path==='/reset'){await this.database.transaction(async tx=>{await tx.execute('DELETE FROM atomic_business');await tx.execute('DELETE FROM longhorn_queue_jobs');await tx.execute('DELETE FROM atomic_effects')});return Response.json({ok:true})}
    if(path==='/publish'){
      this.fault=data.fault
      try{
        const result=await this.database.transaction(async tx=>{
          if(!isTransactionExecutor(tx))throw new Error('Original transaction lacks provenance')
          await tx.execute({sql:'INSERT INTO atomic_business(id,title) VALUES(?,?)',args:[data.id,data.title??'saved']})
          const pending=enqueueInTransaction(this.queue,tx,{businessId:data.invalid?'':data.id})
          let job
          if(data.detached)void pending
          else if(data.caught)await pending.catch(()=>{})
          else job=await pending
          if(data.failure)throw new Error('owned business failure')
          return{id:data.id,...(job?{job}:{} )}
        })
        return Response.json({ok:true,...result})
      }catch(error){return Response.json({ok:false,name:error.name})}
    }
    if(path==='/state')return Response.json({boot:this.boot,alarm:await this.clock.getAlarm(),business:(await this.database.execute('SELECT id,title FROM atomic_business ORDER BY id')).rows,
      jobs:(await this.database.execute('SELECT id,state,payload FROM longhorn_queue_jobs ORDER BY id')).rows,effects:(await this.database.execute('SELECT job_id,title FROM atomic_effects')).rows})
    return new Response('missing',{status:404})
  }
}
export default{fetch(request,env){return env.STORE.get(env.STORE.idFromName('atomic')).fetch(request)}}
