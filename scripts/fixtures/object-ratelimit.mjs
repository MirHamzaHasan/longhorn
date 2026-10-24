import {createDurableSqlite} from '../../runtimes/workers/dist/durable-sqlite.js'
import {alarmClockMigrations} from '../../runtimes/workers/dist/sqlite-alarms.js'
import {migrate} from '../../packages/database/dist/index.js'
import {RateLimiter} from '../../packages/ratelimit/dist/index.js'
import {SqliteRateLimitStore,rateLimitMigrations} from '../../packages/ratelimit/dist/sqlite.js'
import {ReportCoordinator} from '../../examples/durable-worker/src/index.ts'
import {ReportAlarmCoordinator} from '../../examples/durable-worker/src/alarms.ts'
import {createReportApp} from '../../examples/durable-worker/src/app.ts'
import {migrations as reportMigrations} from '../../examples/durable-worker/src/reports.ts'
const table='longhorn_rate_limit_buckets',check=(value,label)=>{if(!value)throw new Error('Object request limit assertion: '+label)}
const post=value=>new Request('http://owned/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
export class CounterFixture {
 constructor(state,env){this.state=state;this.env=env;this.boot=crypto.randomUUID();this.now=100;this.samples=0;this.db=createDurableSqlite(state);this.ready=migrate(this.db,rateLimitMigrations)}
 limiter(input,database=this.db){return new RateLimiter({scope:input.scope,limit:input.limit??2,windowMs:input.windowMs??60000,store:new SqliteRateLimitStore(database),now:()=>{this.samples++;return this.now}})}
 async snapshot(){return{boot:this.boot,now:this.now,samples:this.samples,rows:(await this.db.execute('SELECT scope,subject_hash,claim,policy_limit,window_ms,attempts,expires_at FROM '+table+' ORDER BY scope,subject_hash')).rows}}
 async fetch(request){
  await this.ready;const path=new URL(request.url).pathname,input=request.method==='POST'?await request.json():{}
  if(path==='/state')return Response.json(await this.snapshot())
  if(path==='/time'){this.now=input.now;return Response.json({now:this.now})}
  if(path==='/hold'){
   await this.db.transaction(async tx=>{await tx.execute({sql:'UPDATE '+table+' SET attempts=attempts WHERE scope=?',args:[input.scope]});const next=await(await fetch(this.env.GATE_URL+'/input-gate')).text();this.now=Number(next)})
   return Response.json({released:true})
  }
  if(path==='/cleanup'){
   this.now=100;const live=this.limiter({scope:'live-cleanup',limit:1});await live.consume('live')
   try{
    for(const [index,scope]of['one','two','three'].entries())await this.db.execute({sql:'INSERT INTO '+table+'(scope,subject_hash,claim,policy_limit,window_ms,attempts,expires_at) VALUES(?,?,?,1,1000,1,1)',args:[scope,String(index).repeat(64),'fixture']})
    check(await live.prune(2)===2,'bounded first prune');check(await live.prune(2)===1,'table-wide remaining prune');check(await live.prune(2)===0,'live expiry preserved');check((await this.db.execute('SELECT count(*) AS total FROM '+table)).rows[0].total===1,'only live bucket remains')
    return Response.json({bounded:true,tableWide:true,livePreserved:true})
   }finally{await live.close()}
  }
  if(path==='/close'){
   let closing,done=false,rejected=false
   const wrapped={...this.db,transaction:work=>this.db.transaction(async tx=>{const value=await work(tx);closing=limiter.close().then(()=>{done=true});try{await limiter.consume('after-close')}catch(error){rejected=error.code==='CLOSED'}check(!done,'close must retain accepted transaction');await fetch(this.env.GATE_URL+'/limiter-drain');return value})},limiter=this.limiter({scope:'close.v1',limit:1},wrapped)
   await limiter.consume('owned');await closing;check(done&&rejected,'close settles and rejects new work');check((await this.db.execute('SELECT 1 AS value')).rows[0].value===1,'borrowed database stays open');await this.db.close();const peer=createDurableSqlite(this.state);try{check((await peer.execute('SELECT 1 AS value')).rows[0].value===1,'platform binding remains open')}finally{await peer.close()}
   return Response.json({reentrantDrain:true,newAdmissionStopped:true,borrowedDatabaseRetained:true,bindingRetained:true})
  }
  let limiter;const original=new Error('owned injected reservation failure')
  try{
   let database=this.db
   if(path==='/fault'||path==='/abort-before')database={...this.db,transaction:work=>this.db.transaction(tx=>work({...tx,execute:async statement=>{const result=await tx.execute(statement);const sql=typeof statement==='string'?statement:statement.sql;if(sql.startsWith('UPDATE '+table)){if(path==='/abort-before')this.state.abort('owned pre-commit quota interruption');throw original}return result}}))}
   limiter=this.limiter(input,database);const decision=await limiter.consume(input.subject??'private subject')
   if(path==='/abort-after'){await this.state.storage.sync();this.state.abort('owned committed quota interruption')}
   return Response.json(decision)
  }catch(error){return Response.json({code:error.code??'storage',original:error===original},{status:503})}finally{await limiter?.close()}
 }
}
class ReportFixture {
 constructor(state,env,alarm){
  this.state=state;this.env=env;this.alarmProfile=alarm;this.boot=crypto.randomUUID();this.db=createDurableSqlite(state)
  this.legacy=[...reportMigrations,...(alarm?alarmClockMigrations:[])]
  this.ready=env.LEGACY==='true'?migrate(this.db,this.legacy):Promise.resolve()
  const bindings={...env,...(alarm?{REPORT_LIMIT_WINDOW_MS:env.ALARM_WINDOW_MS??env.REPORT_LIMIT_WINDOW_MS}:{})}
  this.actual=env.LEGACY==='true'?undefined:alarm?new ReportAlarmCoordinator(state,bindings):new ReportCoordinator(state,bindings)
 }
 async snapshot(){
  const exists=(await this.db.execute("SELECT name FROM sqlite_master WHERE name='"+table+"'")).rows.length>0
  return{boot:this.boot,history:(await this.db.execute('SELECT position,id,checksum FROM longhorn_migrations ORDER BY position')).rows,quota:exists?(await this.db.execute('SELECT scope,subject_hash,claim,policy_limit,window_ms,attempts,expires_at FROM '+table)).rows:[],quotaTable:exists,jobs:(await this.db.execute('SELECT id,state,attempts FROM longhorn_queue_jobs ORDER BY id')).rows,schedules:(await this.db.execute('SELECT id,next_at,dispatch_count,state FROM longhorn_schedules ORDER BY id')).rows,effects:(await this.db.execute('SELECT job_id,result FROM worker_reports ORDER BY job_id')).rows,alarm:await this.state.storage.getAlarm()}
 }
 async fetch(request){
  await this.ready;const path=new URL(request.url).pathname
  if(path==='/_legacy'){await request.arrayBuffer();await this.db.execute("INSERT INTO worker_reports(job_id,result) VALUES('old-effect','{\"sum\":7}') ON CONFLICT(job_id) DO NOTHING");return Response.json(await this.snapshot())}
  if(path==='/_bad-upgrade'){
   await request.arrayBuffer();let failed=false;try{await migrate(this.db,[...this.legacy,...rateLimitMigrations,{id:'owned-broken-quota-upgrade',statements:['INSERT INTO missing_owned_table(value) VALUES(1)']}])}catch{failed=true}
   check(failed,'native upgrade must fail');return Response.json(await this.snapshot())
  }
  if(this.actual){const health=await this.actual.fetch(new Request('http://private/health'));if(!health.ok)return health}
  if(path==='/_inspect')return Response.json(await this.snapshot())
  return this.actual?this.actual.fetch(request):new Response(null,{status:503})
 }
 alarm(info){return this.actual?.alarm?.(info)}
}
export class PlainFixture extends ReportFixture {constructor(state,env){super(state,env,false)}}
export class AlarmFixture extends ReportFixture {constructor(state,env){super(state,env,true)}alarm(info){return super.alarm(info)}}
export class HttpDrainFixture {
 constructor(state,env){
  this.state=state;this.env=env;this.held=false;this.syncCalled=false;this.closed=false;let quota=false
  const storage=state.storage,sql={exec:(text,...args)=>{const result=storage.sql.exec(text,...args);if(text.startsWith('UPDATE '+table))quota=true;return result}}
  const wrapped={blockConcurrencyWhile:state.blockConcurrencyWhile.bind(state),storage:{sql,transaction:work=>storage.transaction(async()=>{const value=await work();if(quota){quota=false;this.held=true;this.closing=this.app.close().then(()=>{this.closed=true});await Promise.resolve();check(!this.closed&&!this.syncCalled,'HTTP must retain native transaction and database');await(await fetch(env.GATE_URL+'/http-drain')).arrayBuffer()}return value}),sync:async()=>{this.syncCalled=true;await storage.sync()}}}
  this.app=createReportApp(wrapped,{requestLimits:{limit:1,windowMs:60000}})
 }
 async fetch(request){
  await request.arrayBuffer();await this.app.start();const response=await this.app.fetch(post({numbers:[3,7]}));check(response.status===202,'accepted report completed');await this.closing;check(this.closed&&this.syncCalled,'database closes last')
  const database=createDurableSqlite(this.state);try{check((await database.execute('SELECT count(*) AS total FROM longhorn_queue_jobs')).rows[0].total===1,'one admitted report');check((await database.execute('SELECT attempts FROM '+table)).rows[0].attempts===1,'one retained attempt')}finally{await database.close()}
  return Response.json({httpDrained:true,limiterDrained:true,databaseClosedLast:true,oneAdmittedJob:true})
 }
}
export default{fetch(request,env){const url=new URL(request.url),prefix=url.pathname.split('/')[1],binding=prefix==='counter'||prefix==='cleanup'||prefix==='close'?env.COUNTERS:prefix==='drain'?env.DRAIN:prefix==='alarm'?env.ALARMS:env.PLAIN,name=prefix==='cleanup'||prefix==='close'?prefix:'reports';url.pathname=url.pathname.slice(prefix.length+1)||'/';return binding.get(binding.idFromName(name)).fetch(new Request(url,request))}}
