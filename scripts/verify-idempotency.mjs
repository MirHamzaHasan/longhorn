import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migrate } from '../packages/database/dist/index.js'
import { Idempotency,IdempotencyConflictError } from '../packages/idempotency/dist/index.js'
import { SqliteIdempotencyStore,idempotencyMigrations } from '../packages/idempotency/dist/sqlite.js'
import { PostgresIdempotencyStore } from '../packages/idempotency/dist/postgres.js'
import { Queue } from '../packages/queue/dist/index.js'
import { SqliteQueueStore,queueMigrations } from '../packages/queue/dist/sqlite.js'
import { PostgresQueueStore } from '../packages/queue/dist/postgres.js'
import { enqueueInTransaction } from '../packages/queue/dist/transaction.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-idempotency-'))
const children=[],workers=[],databases=[];let sandbox
const schema={'~standard':{version:1,vendor:'idempotency-gate',validate:value=>({value})}}
const post=(value,key)=>({method:'POST',headers:{'Content-Type':'application/json',...(key===undefined?{}:{'Idempotency-Key':key})},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)})
const waitFor=async predicate=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Idempotency condition did not settle')}
function launch(script,env){
  const child=spawn(process.execPath,[join(root,script)],{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance
}
const record=(instance,stage)=>waitFor(()=>{const value=instance.records.find(value=>value.stage===stage);if(value)return value;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());return false})
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
async function processProof(database,pg,environment){
  const ledger=pg?'longhorn_idempotency.requests':'longhorn_idempotency_requests',business=pg?'longhorn_pg_example.tasks':'idempotent_business',jobs=pg?'longhorn_queue.jobs':'longhorn_queue_jobs'
  const count=async(table,key)=>Number((await database.execute({sql:`SELECT count(*) AS n FROM ${table}${key?` WHERE request_key=${pg?'$1':'?'}`:''}`,args:key?[key]:[]})).rows[0].n)
  const producer=(key,mode)=>launch('scripts/fixtures/idempotency-process.mjs',{...environment,LONGHORN_IDEMPOTENCY_KEY:key,LONGHORN_IDEMPOTENCY_MODE:mode})
  const before=producer('killed-before','pause-before');await record(before,'before-commit')
  assert.equal(await count(ledger),0);assert.equal(await count(business),0);assert.equal(await count(jobs),0)
  assert.equal((await end(before,'SIGKILL')).signal,'SIGKILL')
  const recovered=producer('killed-before');const outcome=await record(recovered,'committed');assert.equal(outcome.replayed,false);assert.equal((await end(recovered)).code,0,recovered.output())
  const after=producer('killed-after','pause-after'),committed=await record(after,'committed');assert.equal((await end(after,'SIGKILL')).signal,'SIGKILL')
  const replay=producer('killed-after'),replayed=await record(replay,'committed');assert.equal((await end(replay)).code,0,replay.output());assert.equal(replayed.replayed,true);assert.deepEqual(replayed.value,committed.value)
  const first=producer('contended','pause-before');await record(first,'before-commit')
  const contender=producer('contended');await record(contender,'started')
  first.child.stdin.write('commit\n');const a=await record(first,'committed'),b=await record(contender,'committed')
  assert.equal((await end(first)).code,0,first.output());assert.equal((await end(contender)).code,0,contender.output())
  assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.deepEqual(a.value,b.value)
  assert.equal(await count(ledger),3);assert.equal(await count(business),3);assert.equal(await count(jobs),3)
  assert.equal(contender.records.some(value=>value.stage==='before-commit'),false)
}
async function lifecycleProof(database,pg){
  let time=1000
  const requests=new Idempotency({store:pg?new PostgresIdempotencyStore(database):new SqliteIdempotencyStore(database),now:()=>time,retentionMs:100})
  const queue=new Queue({name:'idempotent.lifecycle.v1',schema,store:pg?new PostgresQueueStore(database):new SqliteQueueStore(database)})
  const input={scope:'lifecycle:v1',key:'shared-key',input:{title:'same'}}
  const create=async tx=>{
    const row=(await tx.execute(pg?{sql:'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id',args:['lifecycle']}:
      {sql:'INSERT INTO idempotent_business(title) VALUES(?) RETURNING id',args:['lifecycle']})).rows[0]
    const id=String(row.id),job=await enqueueInTransaction(queue,tx,{id});return{id,job}
  }
  try{
    const outcomes=await Promise.all(Array.from({length:8},()=>requests.run(input,create)))
    assert.equal(outcomes.filter(value=>!value.replayed).length,1);assert.equal(new Set(outcomes.map(value=>value.value.id)).size,1)
    await assert.rejects(requests.run({...input,input:{title:'changed'}},create),IdempotencyConflictError)
    const error=new Error('owned native rollback')
    await assert.rejects(requests.run({...input,key:'rollback'},async tx=>{await create(tx);throw error}),value=>value===error)
    assert.equal((await requests.run({...input,key:'rollback'},create)).replayed,false)
    time=1100
    const replacement=await requests.run({...input,input:{title:'changed'}},create);assert.equal(replacement.replayed,false);assert.notEqual(replacement.value.id,outcomes[0].value.id)
    assert.equal(await requests.prune(1),1);assert.equal(await requests.prune(1),0)
    time=1200;assert.equal(await requests.prune(1),1)
    time=1300;await requests.run({...input,key:'prune-race'},create);time=1400
    let release,entered;const held=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
    const replacing=requests.run({...input,key:'prune-race',input:{title:'replacement'}},async tx=>{const value=await create(tx);entered();await held;return value})
    await started
    const pruning=requests.prune(100)
    try{if(pg)assert.equal(await pruning,0)}finally{release()}
    assert.equal((await replacing).replayed,false);assert.equal(await pruning,0)
  }finally{await queue.close()}
}
async function host(){
  const instance=launch('examples/postgres/dist/index.js',{DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false'})
  const url=(await waitFor(()=>{const value=instance.records.find(value=>value.message==='HTTP server listening');if(value)return value;if(instance.child.exitCode!==null)throw new Error(instance.output());return false})).fields.url
  return{instance,url}
}
async function make(scriptPath,name,live=false){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),durableObjects:{STORE:{className:'IdempotencyFixture',useSQLite:true}},durableObjectsPersist:join(temporary,name),bindings:live?{LIVE:true}:{}});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://idempotent.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
try{
  const filename=join(temporary,'requests.sqlite'),sqlite=await openSqlite({filename});databases.push(sqlite)
  await migrate(sqlite,[...queueMigrations,...idempotencyMigrations,{id:'idempotent_native/001',statements:['CREATE TABLE idempotent_business(id INTEGER PRIMARY KEY,title TEXT NOT NULL) STRICT']}])
  await processProof(sqlite,false,{LONGHORN_IDEMPOTENCY_FILE:filename});await lifecycleProof(sqlite,false)
  console.log('Native SQLite: separate-process contention, precommit SIGKILL retry, postcommit SIGKILL replay, one business/job/result, conflicts, expiry and bounded pruning verified.')
  sandbox=await startPostgresSandbox();const postgres=await openPostgres({connectionString:sandbox.appUrl,maxConnections:8}),owner=await openPostgres({connectionString:sandbox.ownerUrl});databases.push(postgres,owner)
  await processProof(postgres,true,{LONGHORN_IDEMPOTENCY_PROVIDER:'postgres',LONGHORN_IDEMPOTENCY_URL:sandbox.appUrl});await lifecycleProof(postgres,true)
  const a=await host(),b=await host()
  const responses=await Promise.all(Array.from({length:10},(_,index)=>fetch((index%2?a:b).url+'/tasks/with-report',post({title:index%2?'  idempotent HTTP  ':'idempotent HTTP'},'http-key'))))
  assert.ok(responses.every(value=>value.status===201));assert.equal(responses.filter(value=>value.headers.get('Idempotency-Replayed')==='false').length,1)
  const results=await Promise.all(responses.map(value=>value.json()));for(const value of results)assert.deepEqual(value,results[0])
  const saved=results[0];assert.equal(responses[0].headers.get('location'),'/tasks/'+saved.task.id);assert.equal(responses[0].headers.get('report-location'),'/task-reports/'+saved.job.id)
  assert.equal((await fetch(a.url+'/tasks/with-report',post({title:'changed'},'http-key'))).status,409)
  assert.equal((await fetch(a.url+'/tasks/with-report',post({title:'bad key'},'bad key'))).status,400)
  assert.equal((await fetch(a.url+'/tasks/with-report',post({title:'invalid',extra:true},'invalid-body'))).status,400)
  await owner.execute('REVOKE INSERT ON longhorn_queue.jobs FROM longhorn_app')
  try{assert.equal((await fetch(a.url+'/tasks/with-report',post({title:'retry after rollback'},'rollback-http'))).status,500)}finally{await owner.execute('GRANT INSERT ON longhorn_queue.jobs TO longhorn_app')}
  assert.equal(Number((await owner.execute("SELECT count(*) AS n FROM longhorn_idempotency.requests WHERE request_key='rollback-http'")).rows[0].n),0)
  const retried=await fetch(a.url+'/tasks/with-report',post({title:'retry after rollback'},'rollback-http'));assert.equal(retried.status,201);assert.equal(retried.headers.get('Idempotency-Replayed'),'false')
  assert.equal((await end(a.instance,'SIGTERM')).code,0);assert.equal((await end(b.instance,'SIGTERM')).code,0)
  const restarted=await host(),replayed=await fetch(restarted.url+'/tasks/with-report',post({title:'idempotent HTTP'},'http-key'))
  assert.equal(replayed.status,201);assert.equal(replayed.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replayed.json(),saved)
  assert.equal(Number((await owner.execute("SELECT count(*) AS n FROM longhorn_pg_example.tasks WHERE title='idempotent HTTP'")).rows[0].n),1)
  assert.equal((await end(restarted.instance,'SIGTERM')).code,0)
  console.log('Native PostgreSQL: restricted-role row contention, SIGKILL recovery/replay, conflicts, expiry/pruning, two-host HTTP normalized retries, permission rollback and restart replay verified.')
  await build({entry:{worker:join(root,'scripts/fixtures/idempotency-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,clean:true,silent:true})
  const script=join(temporary,'bundle/worker.js');let worker=await make(script,'object')
  await json(worker,'/time',post({now:2500000000000}))
  const initialBoot=(await json(worker,'/persisted')).boot
  await assert.rejects(json(worker,'/publish',post({key:'abort-before',fault:'abort'})))
  let state=await json(worker,'/persisted');assert.notEqual(state.boot,initialBoot);assert.equal(state.business.length,0);assert.equal(state.jobs.length,0);assert.equal(state.records.length,0);assert.equal(state.alarm,null)
  const concurrent=await Promise.all(Array.from({length:8},()=>json(worker,'/publish',post({key:'abort-before'}))))
  assert.equal(concurrent.filter(value=>!value.replayed).length,1)
  const first=concurrent.find(value=>!value.replayed);for(const value of concurrent)assert.deepEqual(value.value,first.value)
  assert.equal((await worker.dispatchFetch('http://idempotent.example/publish',post({key:'abort-before',title:'changed'}))).status,409)
  assert.equal((await worker.dispatchFetch('http://idempotent.example/publish',post({key:'failure',failure:true}))).status,500)
  const beforeResponseLoss=(await json(worker,'/persisted')).boot
  await assert.rejects(json(worker,'/publish',post({key:'lost-response',loseResponse:true})))
  state=await json(worker,'/persisted');assert.notEqual(state.boot,beforeResponseLoss);assert.equal(state.business.length,2);assert.equal(state.jobs.length,2);assert.equal(state.records.length,2)
  const lost=JSON.parse(state.records.find(value=>value.request_key==='lost-response').result)
  const recovered=await json(worker,'/publish',post({key:'lost-response'}));assert.equal(recovered.replayed,true);assert.deepEqual(recovered.value,lost)
  await dispose(worker);worker=await make(script,'object')
  const restart=await json(worker,'/publish',post({key:'abort-before'}));assert.equal(restart.replayed,true);assert.deepEqual(restart.value,first.value)
  await json(worker,'/time',post({now:2500000000100}))
  const expired=await json(worker,'/publish',post({key:'abort-before',title:'new after expiry'}));assert.equal(expired.replayed,false);assert.notEqual(expired.value.id,first.value.id)
  assert.equal((await json(worker,'/prune',post({limit:1}))).removed,1);assert.equal((await json(worker,'/prune',post({limit:1}))).removed,0)
  const live=await make(script,'live',true),liveFirst=await json(live,'/publish',post({key:'automatic'}))
  await waitFor(async()=>{const value=await json(live,'/persisted');return value.jobs[0]?.state==='succeeded'})
  const liveReplay=await json(live,'/publish',post({key:'automatic'}));assert.equal(liveReplay.replayed,true);assert.deepEqual(liveReplay.value,liveFirst.value)
  const done=await json(live,'/persisted');assert.equal(done.business.length,1);assert.equal(done.jobs.length,1);assert.equal(done.records.length,1);assert.equal(done.effects.length,1)
  console.log('Object SQL: actual precommit abort rolls back business/job/result/alarm; lost postcommit response and host restart replay original result; contention, conflict, expiry/pruning and real alarm consumption retain one effect.')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const disposed=await Promise.allSettled(workers.map(worker=>worker.dispose())),closed=await Promise.allSettled(databases.map(database=>database.close()))
  try{await sandbox?.stop()}finally{await rm(temporary,{recursive:true,force:true})}
  const failures=[...disposed,...closed].filter(value=>value.status==='rejected').map(value=>value.reason)
  if(failures.length)throw new AggregateError(failures,'Idempotency fixture cleanup failed')
}
