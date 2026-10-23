import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migrate } from '../packages/database/dist/index.js'
import { Queue } from '../packages/queue/dist/index.js'
import { SqliteQueueStore,queueMigrations } from '../packages/queue/dist/sqlite.js'
import { PostgresQueueStore } from '../packages/queue/dist/postgres.js'
import { enqueueInTransaction } from '../packages/queue/dist/transaction.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-transaction-publishing-'))
const children=[],workers=[],databases=[];let sandbox,gateway,held
const schema={'~standard':{version:1,vendor:'atomic-gate',validate:value=>({value})}},post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
const waitFor=async predicate=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Atomic publishing condition did not settle')}
function launch(script,env){
  const child=spawn(process.execPath,[join(root,script)],{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance
}
const record=(instance,stage)=>waitFor(()=>instance.records.find(value=>value.stage===stage))
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
async function make(scriptPath,name,extra={}){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),durableObjects:{STORE:{className:'TransactionFixture',useSQLite:true}},durableObjectsPersist:join(temporary,name),...extra});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://atomic.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}

async function processes(database,postgres,environment){
  const store=postgres?new PostgresQueueStore(database):new SqliteQueueStore(database),queue=new Queue({name:'atomic.transaction.v1',schema,store})
  async function exists(id){const result=await database.execute(postgres?{sql:'SELECT id FROM longhorn_pg_example.tasks WHERE id=$1::bigint',args:[id]}:{sql:'SELECT id FROM atomic_business WHERE id=?',args:[id]});return result.rows.length>0}
  try{
    const producer=(label,hold=false)=>launch('scripts/fixtures/transaction-process.mjs',{...environment,LONGHORN_TRANSACTION_TITLE:label,LONGHORN_TRANSACTION_HOLD_AFTER:String(hold)})
    const killed=producer('killed-before-commit'),pending=await record(killed,'before-commit')
    assert.equal(await exists(pending.businessId),false);assert.equal(await queue.get(pending.jobId),undefined)
    assert.equal((await end(killed,'SIGKILL')).signal,'SIGKILL');assert.equal(await exists(pending.businessId),false);assert.equal(await queue.get(pending.jobId),undefined)
    const committed=producer('killed-after-commit',true),ready=await record(committed,'before-commit')
    assert.equal(await exists(ready.businessId),false);assert.equal(await queue.get(ready.jobId),undefined)
    committed.child.stdin.write('commit\n');await record(committed,'committed');assert.equal((await end(committed,'SIGKILL')).signal,'SIGKILL')
    assert.equal(await exists(ready.businessId),true);assert.equal((await queue.get(ready.jobId)).state,'pending')
    const attempt=await queue.runOnce(async data=>{assert.equal(await exists(data.businessId),true)})
    assert.equal(attempt.status,'succeeded')
    const simultaneous=[producer('concurrent-one'),producer('concurrent-two')]
    if(postgres){await Promise.all(simultaneous.map(instance=>record(instance,'before-commit')));for(const instance of simultaneous)instance.child.stdin.write('commit\n')}
    const complete=await Promise.all(simultaneous.map(async instance=>{
      if(!postgres){await record(instance,'before-commit');instance.child.stdin.write('commit\n')}
      const value=await record(instance,'committed');instance.child.stdin.end();assert.equal((await end(instance)).code,0,instance.output());return value
    }))
    assert.equal(new Set(complete.map(value=>value.businessId)).size,2);assert.equal(new Set(complete.map(value=>value.jobId)).size,2)
    for(const value of complete){assert.equal(await exists(value.businessId),true);assert.ok(await queue.get(value.jobId))}
  }finally{await queue.close()}
}
async function scopedPublishing(database,postgres){
  const store=postgres?new PostgresQueueStore(database):new SqliteQueueStore(database)
  const business=title=>postgres?{sql:'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id',args:[title]}:{sql:'INSERT INTO atomic_business(title) VALUES(?) RETURNING id',args:[title]}
  let release,entered;const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
  const slow=new Queue({name:'atomic.join.v1',store,schema:{'~standard':{version:1,vendor:'atomic-join',async validate(value){entered();await gate;return{value}}}}})
  try{
    let finished=false
    const transaction=database.transaction(async tx=>{const id=String((await tx.execute(business('async joined'))).rows[0].id);void enqueueInTransaction(slow,tx,{businessId:id});return id}).then(value=>{finished=true;return value})
    await started;const closing=slow.close();assert.equal(finished,false);release();const id=await transaction;await closing
    const job=(await database.execute(postgres?{sql:'SELECT payload FROM longhorn_queue.jobs WHERE queue=$1',args:[slow.name]}:{sql:'SELECT payload FROM longhorn_queue_jobs WHERE queue=?',args:[slow.name]})).rows[0]
    assert.equal(JSON.parse(job.payload).businessId,id)
  }finally{release();await slow.close()}
  const invalid=new Queue({name:'atomic.invalid.v1',store,schema:{'~standard':{version:1,vendor:'atomic-invalid',validate:()=>({issues:[{message:'owned invalid publication'}]})}}})
  try{
    await assert.rejects(database.transaction(async tx=>{await tx.execute(business('caught invalid publication'));await enqueueInTransaction(invalid,tx,{}).catch(()=>{})}),error=>error?.name==='ValidationError')
    const remaining=(await database.execute(postgres?{sql:'SELECT count(*) AS n FROM longhorn_pg_example.tasks WHERE title=$1',args:['caught invalid publication']}:{sql:'SELECT count(*) AS n FROM atomic_business WHERE title=?',args:['caught invalid publication']})).rows[0].n
    assert.equal(Number(remaining),0)
  }finally{await invalid.close()}
}
try{
  const filename=join(temporary,'atomic.sqlite'),sqlite=await openSqlite({filename});databases.push(sqlite)
  await migrate(sqlite,[...queueMigrations,{id:'atomic_native/001_business',statements:['CREATE TABLE atomic_business(id INTEGER PRIMARY KEY,title TEXT NOT NULL) STRICT']}])
  await processes(sqlite,false,{LONGHORN_TRANSACTION_FILE:filename})
  await scopedPublishing(sqlite,false)
  console.log('Native SQLite processes: neither business/job visible before commit; SIGKILL before commit rolls both back, after commit preserves both; competing producers and committed-row consumption verified.')

  sandbox=await startPostgresSandbox();const postgres=await openPostgres({connectionString:sandbox.appUrl,maxConnections:4}),owner=await openPostgres({connectionString:sandbox.ownerUrl});databases.push(postgres,owner)
  await processes(postgres,true,{LONGHORN_TRANSACTION_PROVIDER:'postgres',LONGHORN_TRANSACTION_URL:sandbox.appUrl})
  await scopedPublishing(postgres,true)
  const queue=new Queue({name:'atomic.guard.v1',schema,store:new PostgresQueueStore(postgres)})
  try{
    const original=new Error('business failure')
    await assert.rejects(postgres.transaction(async tx=>{await tx.execute("INSERT INTO longhorn_pg_example.tasks(title) VALUES('must rollback')");await enqueueInTransaction(queue,tx,{businessId:'rollback'});throw original}),error=>error===original)
    assert.equal((await postgres.execute("SELECT count(*) AS n FROM longhorn_pg_example.tasks WHERE title='must rollback'")).rows[0].n,0n)
  }finally{await queue.close()}
  const host=launch('examples/postgres/dist/index.js',{DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false'})
  if(host.child.exitCode!==null)throw new Error(host.output())
  const address=(await waitFor(()=>host.records.find(value=>value.message==='HTTP server listening'))).fields.url
  const created=await fetch(address+'/tasks/with-report',post({title:'created atomically'}));assert.equal(created.status,201)
  const bundled=await created.json();assert.equal(created.headers.get('location'),'/tasks/'+bundled.task.id);assert.equal(created.headers.get('report-location'),'/task-reports/'+bundled.job.id)
  assert.equal((await(await fetch(address+'/task-reports/'+bundled.job.id)).json()).job.state,'pending')
  await owner.execute('REVOKE INSERT ON longhorn_queue.jobs FROM longhorn_app')
  try{assert.equal((await fetch(address+'/tasks/with-report',post({title:'permission rollback'}))).status,500)}finally{await owner.execute('GRANT INSERT ON longhorn_queue.jobs TO longhorn_app')}
  assert.equal((await postgres.execute("SELECT count(*) AS n FROM longhorn_pg_example.tasks WHERE title='permission rollback'")).rows[0].n,0n)
  assert.equal((await end(host,'SIGTERM')).code,0,host.output())
  const consumer=launch('examples/postgres/dist/index.js',{DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',WORKER_ENABLED:'true',SCHEDULER_ENABLED:'false'})
  const consumerUrl=(await waitFor(()=>consumer.records.find(value=>value.message==='HTTP server listening'))).fields.url
  const completed=await waitFor(async()=>{const value=await(await fetch(consumerUrl+'/task-reports/'+bundled.job.id)).json();return value.job?.state==='succeeded'&&value.report?value:undefined})
  assert.ok(BigInt(completed.report.total)>=1n)
  assert.equal((await(await fetch(consumerUrl+'/tasks/'+bundled.task.id)).json()).task.title,'created atomically')
  assert.equal((await end(consumer,'SIGTERM')).code,0,consumer.output())
  console.log('Native PostgreSQL: restricted-role transactional publish, visibility/SIGKILL/concurrent-producer proofs, actual task/report HTTP and permission-failure rollback verified.')

  gateway=createServer((request,response)=>{held=response;response.on('close',()=>{if(held===response)held=undefined})});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const bundle=join(temporary,'worker');await build({entry:{worker:join(root,'scripts/fixtures/transaction-worker.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const script=join(bundle,'worker.js'),bindings={GATE_URL:`http://127.0.0.1:${gateway.address().port}`}
  let worker=await make(script,'object',{bindings})
  assert.equal((await json(worker,'/publish',post({id:'one'}))).ok,true);let state=await json(worker,'/state')
  assert.equal(state.business.length,1);assert.equal(state.jobs.length,1);assert.ok(state.alarm!==null)
  await json(worker,'/reset',post({}))
  for(const input of [{id:'rollback',failure:true},{id:'invalid',invalid:true,caught:true},{id:'alarm-rollback',fault:'throw'}]){
    assert.equal((await json(worker,'/publish',post(input))).ok,false);state=await json(worker,'/state');assert.equal(state.business.length,0);assert.equal(state.jobs.length,0);assert.equal(state.alarm,null)
  }
  const previous=(await json(worker,'/state')).boot
  assert.equal((await worker.dispatchFetch('http://atomic.example/publish',post({id:'interrupted',fault:'abort'}))).ok,false)
  state=await json(worker,'/persisted');assert.notEqual(state.boot,previous);assert.equal(state.business.length,0);assert.equal(state.jobs.length,0);assert.equal(state.alarm,null)
  let returned=false;const detached=json(worker,'/publish',post({id:'slow',detached:true})).then(value=>{returned=true;return value})
  await waitFor(()=>held);assert.equal(returned,false);held.end('validated');assert.equal((await detached).ok,true)
  state=await json(worker,'/state');assert.equal(state.business.length,1);assert.equal(state.jobs.length,1);assert.ok(state.alarm!==null)
  await dispose(worker);worker=await make(script,'object',{bindings});state=await json(worker,'/state');assert.equal(state.business.length,1);assert.equal(state.jobs.length,1)
  const live=await make(script,'live',{bindings:{...bindings,LIVE:true}})
  assert.equal((await json(live,'/publish',post({id:'automatic'}))).ok,true)
  const consumed=await waitFor(async()=>{const value=await json(live,'/state');return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.equal(consumed.effects.length,1);assert.equal(consumed.effects[0].title,'saved');assert.equal(consumed.alarm,null)
  console.log('Object SQL: business/job/alarm commit together; caught validation/business/alarm failures and actual Object abort roll all back; detached async validation drains, state survives restart, and native alarm consumes the committed business row.')
}finally{
  held?.end('cleanup')
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const cleanup=await Promise.allSettled(workers.map(worker=>worker.dispose()))
  try{if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})}
  finally{await Promise.allSettled(databases.map(database=>database.close()));await sandbox?.stop();await rm(temporary,{recursive:true,force:true})}
  const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason)
  if(errors.length)throw new AggregateError(errors,'Owned transaction fixture cleanup failed')
}
