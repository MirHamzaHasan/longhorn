import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {startPostgresSandbox} from './postgres-sandbox.mjs'
import {openPostgres} from '../runtimes/node/dist/postgres.js'
import {Queue} from '../packages/queue/dist/index.js'
import {PostgresQueueStore} from '../packages/queue/dist/postgres.js'
import {Scheduler} from '../packages/scheduler/dist/index.js'
import {PostgresSchedulerStore} from '../packages/scheduler/dist/postgres.js'
import {verifyPostgresAccounts} from './postgres-auth-checks.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)), instances=[]
let sandbox,owner,backgroundDatabase
function launch(binary,args,env={}){
 const child=spawn(binary,args,{cwd:root,stdio:['pipe','pipe','pipe'],env:{...process.env,...env}})
 let output='';const records=[]
 createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
 child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
 const instance={child,records,ended,output:()=>output};instances.push(instance);return instance
}
async function completed(instance,killed=false){
 const timeout=setTimeout(()=>instance.child.kill('SIGKILL'),60000)
 try{const result=await instance.ended;if(killed)assert.equal(result.signal,'SIGKILL',instance.output());else assert.equal(result.code,0,instance.output());return instance.records}
 finally{clearTimeout(timeout)}
}
async function record(instance,predicate){
 const deadline=Date.now()+10000
 while(Date.now()<deadline){const found=instance.records.find(predicate);if(found)return found;if(instance.child.exitCode!==null||instance.child.signalCode!==null)break;await new Promise(resolve=>setTimeout(resolve,15))}
 throw new Error('Expected native child output missing: '+instance.output())
}
async function stop(instance){if(instance.child.exitCode!==null||instance.child.signalCode!==null)return;instance.child.kill('SIGTERM');await completed(instance)}
async function dispose(instance){if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL');await instance.ended}
const request=(url,path,options)=>fetch(url+path,{...options,signal:AbortSignal.timeout(5000)})
const body=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
async function host(background=true,environment={}){
 const instance=launch(process.execPath,[join(root,'examples/postgres/dist/index.js')],{DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',WORKER_ENABLED:String(background),SCHEDULER_ENABLED:String(background),...environment})
 return {instance,url:(await record(instance,value=>value.message==='HTTP server listening')).fields.url}
}
try{
 sandbox=await startPostgresSandbox()
 console.log('Native PostgreSQL '+sandbox.version+': isolated cluster with password authentication and separate nonsuperuser owner/runtime roles.')
 const env={LONGHORN_PG_TEST_OWNED:'true',LONGHORN_PG_TEST_URL:sandbox.ownerUrl,LONGHORN_PG_APP_URL:sandbox.appUrl}
 const tests=launch('pnpm',['exec','vitest','run','--config','vitest.postgres.config.ts'],env)
 await completed(tests);process.stdout.write(tests.output())
 owner=await openPostgres({connectionString:sandbox.ownerUrl})
 const migrate=()=>launch(process.execPath,[join(root,'scripts/fixtures/postgres-migrations.mjs')],env)
 const concurrent=(await Promise.all([completed(migrate()),completed(migrate())])).flat()
 assert.deepEqual(concurrent.flatMap(value=>value.added??[]),['initial'])
 assert.equal((await owner.execute('SELECT count(*) AS count FROM process_migration_qa.items')).rows[0].count,1n)
 const crashed=launch(process.execPath,[join(root,'scripts/fixtures/postgres-migrations.mjs'),'crash'],env)
 await record(crashed,value=>value.paused);crashed.child.kill('SIGKILL');await completed(crashed,true)
 assert.equal((await owner.execute("SELECT pg_catalog.to_regnamespace('crash_migration_qa') AS name")).rows[0].name,null)
 await completed(launch(process.execPath,[join(root,'scripts/fixtures/postgres-migrations.mjs'),'recover'],env))
 assert.equal((await owner.execute('SELECT count(*) AS count FROM crash_migration_qa.items')).rows[0].count,1n)
 console.log('Migrations: initial concurrent processes serialize; SIGKILL inside DDL/metadata transaction rolls back and recovers once.')
 const migration=launch(process.execPath,[join(root,'examples/postgres/dist/migrate.js')],{MIGRATION_DATABASE_URL:sandbox.ownerUrl})
 const migrationRecords=await completed(migration)
 assert.ok(migrationRecords.some(value=>value.message==='PostgreSQL migrations applied'&&value.fields.added.length===0))
 await owner.execute('TRUNCATE longhorn_pg_example.tasks RESTART IDENTITY')
 const a=await host(),b=await host()
 assert.equal((await request(a.url,'/readyz')).status,200)
 const created=await Promise.all(Array.from({length:12},(_,index)=>request(index%2?a.url:b.url,'/tasks',body({title:'native-'+index}))))
 assert.ok(created.every(response=>response.status===201))
 const tasks=await Promise.all(created.map(async response=>(await response.json()).task))
 assert.equal(new Set(tasks.map(task=>task.id)).size,12)
 const page=await(await request(a.url,'/tasks?limit=5')).json()
 assert.equal(page.tasks.length,5);assert.ok(page.nextCursor)
 const next=await(await request(a.url,'/tasks?limit=100&after='+page.nextCursor)).json()
 assert.equal(next.tasks.length,7)
 assert.ok(!next.tasks.some(task=>page.tasks.some(previous=>previous.id===task.id)))
 const updated=await request(a.url,'/tasks/'+tasks[0].id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({completed:true})})
 assert.equal(updated.status,200)
 assert.equal((await(await request(b.url,'/tasks?completed=true')).json()).tasks.length,1)
 await stop(a.instance);await stop(b.instance)
 const restarted=await host()
 assert.equal((await(await request(restarted.url,'/tasks?limit=100')).json()).tasks.length,12)
 assert.equal((await request(restarted.url,'/tasks/'+tasks[0].id,{method:'DELETE'})).status,204)
 await stop(restarted.instance)
 assert.ok(restarted.instance.records.some(value=>value.message==='Application stopped'))
 console.log('PostgreSQL HTTP: restricted-role CRUD, concurrent writers, cursor pages, boolean filters, restart persistence and pool shutdown verified.')
 await owner.execute('TRUNCATE longhorn_queue.jobs,longhorn_scheduler.schedules,longhorn_pg_example.task_reports')
 backgroundDatabase=await openPostgres({connectionString:sandbox.appUrl,maxConnections:4})
 const store=new PostgresQueueStore(backgroundDatabase)
 const schema={'~standard':{version:1,vendor:'postgres-process-qa',validate:input=>({value:input})}}
 const fixture=(mode,queue='native.process.v1')=>launch(process.execPath,[join(root,'scripts/fixtures/postgres-background.mjs'),mode],{...env,LONGHORN_PG_QUEUE:queue})
 async function release(instance){await record(instance,value=>value.ready);instance.child.stdin.end('go\n');return instance}
 const queue=new Queue({name:'native.process.v1',schema,store})
 try{
  const seeded=await Promise.all(Array.from({length:24},()=>queue.enqueue({value:1})))
  const consumers=[fixture('consume'),fixture('consume')]
  await Promise.all(consumers.map(instance=>record(instance,value=>value.ready)))
  for(const instance of consumers)instance.child.stdin.end('go\n')
  const results=await Promise.all(consumers.map(instance=>completed(instance)))
  assert.ok(results.every(rows=>rows.some(row=>row.handled)))
  const handled=results.flat().filter(row=>row.handled)
  assert.equal(handled.length,24);assert.equal(new Set(handled.map(row=>row.handled)).size,24)
  for(const job of seeded)assert.equal((await queue.get(job.id)).state,'succeeded')
  assert.equal((await owner.execute('SELECT count(*) AS count FROM longhorn_pg_example.task_reports')).rows[0].count,24n)
 }finally{await queue.close()}
 for(const [mode,maxAttempts] of [['claim-crash',2],['effect-crash',2],['claim-crash',1]]){
  const name='native.crash.'+mode+'.'+maxAttempts,crashQueue=new Queue({name,schema,store})
  try{
   const job=await crashQueue.enqueue({value:1},{maxAttempts})
   const crashed=fixture(mode,name);await record(crashed,value=>value.handlerPaused)
   const stale=await store.get(name,job.id)
   crashed.child.kill('SIGKILL');await completed(crashed,true)
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,stale.leaseUntil-Date.now()+20)))
   const recovered=fixture('consume',name);await release(recovered);await completed(recovered)
   const current=await store.get(name,job.id)
   assert.equal(current.state,maxAttempts===1?'failed':'succeeded')
   assert.equal(current.attempts,maxAttempts)
   assert.equal(await store.complete({queue:name,id:job.id,token:stale.leaseToken,now:Date.now()}),false)
   assert.equal((await owner.execute({sql:'SELECT count(*) AS count FROM longhorn_pg_example.task_reports WHERE job_id=$1',args:[job.id]})).rows[0].count,maxAttempts===1?0n:1n)
  }finally{await crashQueue.close()}
 }
 console.log('PostgreSQL queues: separate consumers share work; SIGKILL before effects/after committed effects recovers with fenced acknowledgement and one idempotent effect; exhausted crashed attempts fail.')
 const scheduleQueue=new Queue({name:'native.scheduled.v1',schema,store}),scheduler=new Scheduler({store:new PostgresSchedulerStore(backgroundDatabase),now:()=>2000})
 try{
  await scheduler.every(scheduleQueue,{value:2},{id:'process-backlog',intervalMs:100,startAt:100,missed:'catch-up'})
  const dispatchers=[fixture('dispatch'),fixture('dispatch')]
  await Promise.all(dispatchers.map(instance=>record(instance,value=>value.ready)))
  for(const instance of dispatchers)instance.child.stdin.end('go\n')
  const results=await Promise.all(dispatchers.map(instance=>completed(instance)))
  assert.ok(results.every(rows=>rows.some(row=>row.dispatched?.length)))
  const dispatched=results.flat().flatMap(row=>row.dispatched??[])
  assert.equal(dispatched.length,20);assert.equal(new Set(dispatched.map(row=>row.jobId)).size,20)
  assert.equal((await scheduler.get('process-backlog')).dispatchCount,20)
  assert.equal((await scheduler.get('process-backlog')).nextAt,2100)
  // This fixture uses synthetic millisecond timestamps; retire it before real-clock HTTP hosts.
  assert.equal(await scheduler.cancel('process-backlog'),true)
  await scheduler.at(scheduleQueue,{value:3},{id:'crash-atomic',at:2000})
  const crashed=fixture('dispatch-crash');await record(crashed,value=>value.transactionPaused)
  crashed.child.kill('SIGKILL');await completed(crashed,true)
  assert.equal(await scheduleQueue.get('scheduled:crash-atomic:2000'),undefined)
  assert.equal((await scheduler.get('crash-atomic')).dispatchCount,0)
  assert.equal((await scheduler.tick()).dispatched.length,1)
  assert.equal((await scheduler.get('crash-atomic')).dispatchCount,1)
  assert.equal((await scheduler.tick()).dispatched.length,0)
 }finally{await scheduler.close();await scheduleQueue.close()}
 console.log('PostgreSQL schedules: separate dispatchers advance one backlog without duplicates; SIGKILL between job insert and cursor update rolls back both writes and recovers once.')
 const producer=await host(false)
 const scheduled=await request(producer.url,'/task-report-schedules',body({id:'persistent-report',scope:'all',schedule:{kind:'once',at:Date.now()}}))
 assert.equal(scheduled.status,200)
 const same=await request(producer.url,'/task-report-schedules',body({id:'persistent-report',scope:'all',schedule:{kind:'once',at:(await scheduled.json()).schedule.firstAt}}))
 assert.equal(same.status,200)
 await stop(producer.instance)
 const consumer=await host()
 const deadline=Date.now()+8000
 while(true){
  const {schedule}=await(await request(consumer.url,'/task-report-schedules/persistent-report')).json()
  if(schedule.lastJobId){
   const {job,report}=await(await request(consumer.url,'/task-reports/'+schedule.lastJobId)).json()
   if(job.state==='succeeded'){assert.equal(report.total,'11');assert.equal(report.completed,'0');assert.ok(!('payload' in job));break}
  }
  assert.ok(Date.now()<deadline,'Scheduled PostgreSQL report did not finish after restart: '+JSON.stringify({schedule,errors:consumer.instance.records.filter(value=>value.level==='error').slice(0,5)}))
  await new Promise(resolve=>setTimeout(resolve,30))
 }
 await stop(consumer.instance)
 console.log('PostgreSQL background HTTP: schedule registered without timers persists across restart, then the worker produces a task report under the restricted runtime role.')
 await verifyPostgresAccounts({host:environment=>host(false,environment),owner,record,completed,stop,
  fixture:(mode,environment={})=>launch(process.execPath,[join(root,'scripts/fixtures/postgres-auth.mjs'),mode],{...env,...environment}),
 })
 const badUrl=new URL(sandbox.appUrl);badUrl.password='intentionally-wrong'
 await assert.rejects(openPostgres({connectionString:badUrl.toString()}),{code:'28P01'})
 console.log('Database authentication: wrong passwords fail against the real server; no normal database or service was touched.')
}finally{await Promise.all(instances.map(dispose));await backgroundDatabase?.close();await owner?.close();await sandbox?.stop()}
