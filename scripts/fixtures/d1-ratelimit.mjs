import { createD1 } from '../../runtimes/workers/dist/d1.js'
import { migrateSqliteBatch } from '../../packages/database/dist/batch.js'
import { RateLimiter } from '../../packages/ratelimit/dist/index.js'
import { BatchSqliteRateLimitStore,batchRateLimitMigrations } from '../../packages/ratelimit/dist/batch-sqlite.js'
import { migrations } from '../../examples/d1-worker/src/schema.ts'
import { createD1TasksApp,TaskDatabase } from '../../examples/d1-worker/src/app.ts'
const check=(condition,message)=>{if(!condition)throw new Error(message)},post=value=>new Request('http://owned/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
const config={maxPending:64,retentionMs:86400000,createLimits:{limit:2,windowMs:60000}}
async function core(binding){
  const db=createD1(binding,{maxPending:64}),normal=new BatchSqliteRateLimitStore(db),limiters=[]
  const limiter=(scope,store=normal,limit=1,windowMs=60000)=>{const value=new RateLimiter({scope,store,limit,windowMs});limiters.push(value);return value}
  try{
    await migrateSqliteBatch(db,batchRateLimitMigrations)
    const savedNow=Date.now;let result
    try{Date.now=()=>0;result=await limiter('native-clock.v1',normal,2,1000).consume('clock')}finally{Date.now=savedNow}
    check(result.resetsAt>1_000_000_000_000,'Application time became authoritative')
    // Native batch failure rolls the reservation back, rather than merely hiding a reply.
    const rollback={dialect:'sqlite',batch:db.batch.bind(db),close:db.close.bind(db),execute:statement=>db.batch([statement,'INSERT INTO missing_owned_limit_table(value) VALUES(1)']).then(rows=>rows[0])}
    let failed=false;try{await limiter('rollback.v1',new BatchSqliteRateLimitStore(rollback)).consume('subject')}catch{failed=true}check(failed,'Failing native suffix committed')
    check((await db.execute("SELECT count(*) AS total FROM longhorn_batch_rate_limit_buckets WHERE scope='rollback.v1'")).rows[0].total===0,'Reservation survived native rollback');check((await limiter('rollback.v1').consume('subject')).allowed,'Rolled-back attempt blocked retry')
    let lost=true
    const drop=createD1({prepare:binding.prepare.bind(binding),async batch(statements){const results=await binding.batch(statements);if(lost){lost=false;throw new Error('private acknowledgement failure')}return results}})
    try{failed=false;try{await limiter('lost-ack.v1',new BatchSqliteRateLimitStore(drop)).consume('subject')}catch{failed=true}check(failed,'Lost native acknowledgement was accepted')}finally{await drop.close()}
    check((await db.execute("SELECT attempts FROM longhorn_batch_rate_limit_buckets WHERE scope='lost-ack.v1'")).rows[0].attempts===1,'Lost acknowledgement retried itself');check(!(await limiter('lost-ack.v1').consume('subject')).allowed,'Committed attempt was forgotten')
    check((await db.execute("SELECT attempts FROM longhorn_batch_rate_limit_buckets WHERE scope='lost-ack.v1'")).rows[0].attempts===2,'Explicit retry did not count once')
    // Keep an actual committed D1 result owned through reentrant limiter close.
    let release,entered=false,closed=false,closing
    const held={dialect:'sqlite',batch:db.batch.bind(db),close:db.close.bind(db),async execute(statement){const value=await db.execute(statement);closing=owned.close().then(()=>{closed=true});entered=true;await new Promise(done=>{release=done});return value}}
    const owned=limiter('drain.v1',new BatchSqliteRateLimitStore(held)),pending=owned.consume('subject');while(!entered)await new Promise(done=>setTimeout(done,0));check(!closed,'Close abandoned native result');release();await pending;await closing;check(closed,'Close did not drain native result')
    return{serverTime:true,nativeBatchRollback:true,lostAckCommittedOnce:true,explicitRetryCounted:true,reentrantNativeDrain:true}
  }finally{await Promise.all(limiters.map(row=>row.close()));await db.close()}
}
async function cleanup(binding){
  const db=createD1(binding),limiter=new RateLimiter({scope:'maintenance',store:new BatchSqliteRateLimitStore(db)})
  try{
    await migrateSqliteBatch(db,batchRateLimitMigrations)
    for(const [index,scope]of['one','two','three'].entries())await db.execute({sql:'INSERT INTO longhorn_batch_rate_limit_buckets(scope,subject_hash,policy_limit,window_ms,attempts,expires_at,observed_at) VALUES(?,?,1,1000,1,1,0)',args:[scope,String(index).repeat(64)]})
    await limiter.consume('live');check(await limiter.prune(2)===2,'Prune exceeded/ignored first bound');check(await limiter.prune(2)===1,'Prune did not cross scopes');check(await limiter.prune(2)===0,'Prune removed a live window');check((await db.execute('SELECT count(*) AS total FROM longhorn_batch_rate_limit_buckets')).rows[0].total===1,'Live bucket was not retained')
    return{bounded:true,tableWide:true,livePreserved:true}
  }finally{await limiter.close();await db.close()}
}
async function applicationDrain(binding){
  const owner=createD1(binding);await migrateSqliteBatch(owner,migrations);await owner.close()
  const quota=new WeakSet();let entered=false,release,closed=false
  const wrapped={prepare(sql){const prepared=binding.prepare(sql);return{bind(...args){const bound=prepared.bind(...args);if(sql.includes('INSERT INTO longhorn_batch_rate_limit_buckets'))quota.add(bound);return bound}}},async batch(statements){const hold=statements.some(statement=>quota.has(statement)),value=await binding.batch(statements);if(hold){entered=true;await new Promise(done=>{release=done})}return value}}
  const app=createD1TasksApp(wrapped,config);await app.start()
  const pending=app.fetch(post({title:'drained native task'}));while(!entered)await new Promise(done=>setTimeout(done,0));const closing=app.close().then(()=>{closed=true});await new Promise(done=>setTimeout(done,5));check(!closed,'HTTP shutdown abandoned accepted D1');check(!app.container.resolve(TaskDatabase).stats().closing,'Borrowed database closed before HTTP drained');release();check((await pending).status===201,'Admitted task failed during close');await closing;check(app.container.resolve(TaskDatabase).stats().closed,'D1 handle did not close')
  return{httpDrained:true,limiterDrained:true,databaseClosedLast:true}
}
export default{async fetch(request,env){
  const path=new URL(request.url).pathname
  if(path==='/contract')return Response.json(await core(env.DB))
  if(path==='/cleanup')return Response.json(await cleanup(env.CLEAN))
  if(path==='/drain')return Response.json(await applicationDrain(env.DRAIN))
  const input=request.method==='POST'?await request.json():{},binding=input.database==='tasks'?env.TASKS:env.DB,db=createD1(binding,{maxPending:64});let limiter
  try{
    if(path==='/sql'){const result=await db.execute({sql:input.sql,args:input.args??[]});return Response.json({rows:result.rows,rowsAffected:result.rowsAffected})}
    if(path==='/legacy'){const previous=migrations.slice(0,migrations.findIndex(row=>row.id===batchRateLimitMigrations[0].id));return Response.json({applied:await migrateSqliteBatch(db,previous)})}
    if(path==='/bad-upgrade'){try{await migrateSqliteBatch(db,[...migrations,{id:'owned-broken-upgrade',statements:['INSERT INTO missing_owned_upgrade(value) VALUES(1)']}]);return Response.json({unexpected:true})}catch{return Response.json({rolledBack:true})}}
    if(path==='/consume'){limiter=new RateLimiter({scope:input.scope,limit:input.limit,windowMs:input.windowMs,store:new BatchSqliteRateLimitStore(db)});try{return Response.json(await limiter.consume(input.subject))}catch(error){return Response.json({code:error.code??'storage'},{status:503})}}
    if(path==='/migrate')return Response.json({applied:await migrateSqliteBatch(db,batchRateLimitMigrations)})
    return new Response(null,{status:404})
  }finally{await limiter?.close();await db.close()}
}}
