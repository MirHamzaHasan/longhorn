import { Longhorn } from '../../packages/core/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { queueMigrations, SqliteQueueStore } from '../../packages/queue/dist/sqlite.js'
import { Scheduler } from '../../packages/scheduler/dist/index.js'
import { schedulerMigrations, SqliteSchedulerStore } from '../../packages/scheduler/dist/sqlite.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { alarmClockMigrations, createSqliteAlarmClock } from '../../runtimes/workers/dist/sqlite-alarms.js'

const schema={'~standard':{version:1,vendor:'alarm-fixture',validate:value=>({value})}}
const migrations=[...queueMigrations,...schedulerMigrations,...alarmClockMigrations,{id:'alarm_fixture/001_effects',statements:['CREATE TABLE effects (id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT']}]
const check=(value,label)=>{if(!value)throw new Error('Alarm fixture assertion: '+label)}

export class AlarmFixture {
  constructor(state,env){
    this.state=state;this.env=env;this.boot=crypto.randomUUID();this.mode='process';this.fault=undefined;this.released=false;this.info=[];this.sets=0
    this.time=env.CLOCK_NOW===undefined?undefined:Number(env.CLOCK_NOW)
    const storage=state.storage,original=storage.setAlarm
    storage.setAlarm=async time=>{
      await original.call(storage,time);this.sets++
      if(this.fault==='throw'){this.fault=undefined;throw new Error('injected after native alarm write')}
      if(this.fault==='abort'){this.fault=undefined;state.abort('owned alarm commit interruption')}
    }
    const app=this.app=new Longhorn(),db=this.database=createDurableSqlite(state)
    this.queue=new Queue({name:'alarm.test',schema,store:new SqliteQueueStore(db),now:()=>this.now(),leaseMs:200,retryDelayMs:150})
    this.scheduler=new Scheduler({store:new SqliteSchedulerStore(db),now:()=>this.now()})
    const queues=env.MANY_QUEUES?['alarm.test',...Array.from({length:63},(_,i)=>'other.'+i)]:['alarm.test']
    const options={database:db,application:app,queues,batchSize:2,minDelayMs:25,failureDelayMs:200,timeoutMs:env.LIVE?5000:150,now:()=>this.now(),handle:invocation=>this.work(invocation)}
    this.options=options;this.clock=createSqliteAlarmClock(state,options)
    app.onStart(async()=>{await migrate(db,migrations);return()=>db.close()})
    app.onStart(async()=>{await this.clock.start();return()=>this.clock.close()})
    app.onStart(()=>()=>this.queue.close());app.onStart(()=>()=>this.scheduler.close())
    app.onStart(()=>{if(env.FAIL_AFTER_CLOCK)throw new Error('owned failure after alarm startup');return()=>{this.released=true}})
  }
  now(){return this.time??Date.now()}
  async work({signal,limit,info}){
    this.info.push({retryCount:info.retryCount,isRetry:info.isRetry});this.info=this.info.slice(-16)
    if(this.env.LIVE)await fetch(this.env.GATE_URL+'/native-alarm')
    if(this.mode==='hold'||this.mode==='ignore')await fetch(this.env.GATE_URL+'/'+this.mode,this.mode==='ignore'?{}:{signal})
    if(this.mode==='failure')throw new Error('owned alarm work failure')
    signal.throwIfAborted()
    await this.scheduler.tick({limit})
    for(let i=0;i<limit;i++){
      signal.throwIfAborted()
      const result=await this.queue.runOnce(async(data,job)=>{
        await this.database.execute({sql:'INSERT INTO effects(id,value) VALUES(?,?) ON CONFLICT(id) DO NOTHING',args:[job.id,JSON.stringify(data)]})
        if(this.mode==='abort-after-effect')this.state.abort('owned alarm interruption after effect')
        if(this.mode==='retry')throw new Error('owned retryable handler failure')
        check(!this.released,'resources before handler completion')
      },{heartbeat:false})
      if(result.status==='idle')break
      if(result.status!=='succeeded')throw new Error('owned report attempt failed')
    }
  }
  alarm(info){return this.clock.alarm(info)}
  async fetch(request){
    const path=new URL(request.url).pathname
    if(path==='/persisted')return Response.json({boot:this.boot,alarm:await this.state.storage.getAlarm(),schedules:this.state.storage.sql.exec('SELECT id,state,next_at,dispatch_count,last_job_id FROM longhorn_schedules ORDER BY id').toArray()})
    if(path==='/run'){
      const input=await request.json();this.mode=input.mode??'process'
      const one=this.clock.alarm(input.info)
      if(input.coalesce)check(one===this.clock.alarm(input.info),'single in-flight invocation')
      try{await one;return Response.json({ok:true})}catch(error){return Response.json({ok:false,name:error.name})}
    }
    if(path==='/close'){await Promise.all([this.clock.close(),this.app.close()]);return Response.json({released:this.released,closed:this.clock.stats().closed})}
    if(path==='/abort'){await this.state.storage.sync();this.state.abort('owned Object reset before alarm delivery')}
    if(path==='/state'&&['stopping','stopped','failed'].includes(this.app.state))return Response.json({boot:this.boot,released:this.released,clock:this.clock.stats(),alarm:await this.clock.getAlarm()})
    if(path==='/activation'){
      await migrate(this.database,[...queueMigrations,...schedulerMigrations])
      const incomplete=createSqliteAlarmClock(this.state,this.options)
      let failed=false;try{await incomplete.start()}catch{failed=true}check(failed,'missing clock migration fails activation')
      check((await this.database.execute('SELECT 1 AS ready')).rows[0].ready===1,'failed activation releases commit hook')
    }
    await this.app.start()
    const input=request.method==='POST'?await request.json():{}
    if(path==='/reset'){
      await this.database.transaction(async tx=>{await tx.execute('DELETE FROM longhorn_queue_jobs');await tx.execute('DELETE FROM longhorn_schedules');await tx.execute('DELETE FROM effects');await tx.execute('UPDATE longhorn_alarm_clock SET retry_after=0 WHERE id=1')})
      this.mode='process';return Response.json({ok:true})
    }
    if(path==='/register')return Response.json({schedule:await this.scheduler.at(this.queue,{value:input.id},{id:input.id,at:input.at})})
    if(path==='/every')return Response.json({schedule:await this.scheduler.every(this.queue,{value:input.id},{id:input.id,intervalMs:input.intervalMs,startAt:input.at})})
    if(path==='/cancel')return Response.json({cancelled:await this.scheduler.cancel(input.id)})
    if(path==='/enqueue')return Response.json({job:await this.queue.enqueue({value:input.id},{id:input.id,delayMs:input.delay??0})})
    if(path==='/claim')return Response.json({job:await new SqliteQueueStore(this.database).claim({queue:'alarm.test',now:this.now(),leaseMs:input.leaseMs??200,token:'owned-token'})})
    if(path==='/time'){this.time=input.now;await this.clock.reconcile();return Response.json({ok:true})}
    if(path==='/mode'){this.mode=input.mode;return Response.json({ok:true})}
    if(path==='/validation'){
      for(const config of [{queues:[]},{queues:['duplicate','duplicate']},{queues:['bad name']},{batchSize:0},{minDelayMs:0},{failureDelayMs:3600001},{timeoutMs:900001}]){
        let failed=false;try{createSqliteAlarmClock(this.state,{...this.options,...config})}catch{failed=true}check(failed,'configuration bounds')
      }
      let wrong=false;try{createSqliteAlarmClock({...this.state,storage:{}},this.options)}catch{wrong=true}check(wrong,'storage ownership')
      const duplicate=createSqliteAlarmClock(this.state,this.options)
      let failed=false;try{await duplicate.start()}catch{failed=true}check(failed,'exclusive Object alarm owner')
      return Response.json({ok:true})
    }
    if(path==='/fault'){
      this.fault=input.kind
      try{await this.scheduler.at(this.queue,{value:input.id},{id:input.id,at:input.at});return Response.json({ok:true})}
      catch(error){return Response.json({ok:false,name:error.name})}
    }
    if(path==='/second-handle'){
      const other=createDurableSqlite(this.state)
      try{await other.execute({sql:'UPDATE longhorn_schedules SET next_at = ? WHERE id = ?',args:[input.at,input.id]})}finally{await other.close()}
      return Response.json({ok:true})
    }
    if(path==='/state'||path==='/activation')return Response.json({boot:this.boot,released:this.released,clock:this.clock.stats(),alarm:await this.clock.getAlarm(),sets:this.sets,info:this.info,
      jobs:(await this.database.execute('SELECT id,state,attempts,available_at,lease_until FROM longhorn_queue_jobs ORDER BY id')).rows,
      schedules:(await this.database.execute('SELECT id,state,next_at,dispatch_count,last_job_id FROM longhorn_schedules ORDER BY id')).rows,
      effects:(await this.database.execute('SELECT id,value FROM effects ORDER BY id')).rows,
      floor:(await this.database.execute('SELECT retry_after FROM longhorn_alarm_clock WHERE id=1')).rows[0].retry_after,
    })
    return new Response('missing',{status:404})
  }
}
export default{fetch(request,env){return env.STORE.get(env.STORE.idFromName('alarm')).fetch(request)}}
