import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
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
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { SqliteOutboxStore,outboxMigrations,outboxRecoveryMigrations } from '../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore,postgresOutboxMigrations,postgresOutboxRecoveryMigrations } from '../packages/outbox/dist/postgres.js'
import { queueMigrations } from '../packages/queue/dist/sqlite.js'
import { postgresExampleMigrations } from '../examples/postgres/dist/migrations.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-outbox-recovery-')),children=[],workers=[],databases=[];let sandbox
const token=randomBytes(32).toString('hex'),schema={'~standard':{version:1,vendor:'native-recovery',validate:value=>({value})}}
const reject={async publish(){throw new Error('owned failure')}}
const post=(body,credential)=>({method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
const auth={headers:{Authorization:'Bearer '+token}}
const waitFor=async predicate=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Outbox recovery condition did not settle')}
function launch(script,env){const child=spawn(process.execPath,[join(root,script)],{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}});child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance}
const record=(instance,stage)=>waitFor(()=>{const found=instance.records.find(value=>value.stage===stage);if(found)return found;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());return false})
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
async function make(scriptPath,extra={}){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),...extra});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://recovery.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
async function driver(database,pg,environment,maintenanceEnvironment,broker){
  const store=pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database),name=pg?'recovery.postgres.v1':'recovery.sqlite.v1',outgoing=new Outbox({name,schema,store,retryDelayMs:0})
  const child=(mode,id,expected=1,env=environment)=>launch('scripts/fixtures/outbox-recovery-process.mjs',{...env,LONGHORN_RECOVERY_NAME:name,LONGHORN_RECOVERY_MODE:mode,LONGHORN_RECOVERY_ID:id,LONGHORN_RECOVERY_EXPECTED:String(expected)})
  const release=instance=>instance.child.stdin.write('go\n')
  async function result(instance){const value=await record(instance,'result');assert.equal((await end(instance)).code,0,instance.output());return value.result}
  async function failed(){const value=await outgoing.enqueue({secret:'private recovery payload'},{maxAttempts:1});assert.equal((await outgoing.dispatchOnce(reject)).status,'failed');return value}
  const brokerUrl=String(await broker.ready).replace(/\/$/,'')
  const publisher={async publish(message){const response=await fetch(brokerUrl+'/accept',post(message));assert.equal(response.status,204);await response.text()}}
  try{
    const recordOne=await failed(),before=child('retry-before-commit',recordOne.id)
    await record(before,'ready');release(before);await record(before,'before-commit')
    assert.equal((await outgoing.get(recordOne.id)).state,'failed');assert.equal((await outgoing.get(recordOne.id)).maxAttempts,1)
    assert.equal((await end(before,'SIGKILL')).signal,'SIGKILL');assert.equal((await outgoing.get(recordOne.id)).state,'failed')
    const after=child('retry-after-commit',recordOne.id);await record(after,'ready');release(after);assert.equal((await record(after,'result')).result.status,'scheduled')
    assert.equal((await end(after,'SIGKILL')).signal,'SIGKILL');assert.equal((await outgoing.get(recordOne.id)).maxAttempts,2)
    assert.equal((await outgoing.retryFailed(recordOne.id,{expectedMaxAttempts:1,additionalAttempts:1})).status,'conflict')
    assert.equal((await outgoing.dispatchOnce(publisher)).status,'succeeded')
    const contendersRecord=await failed(),a=child('retry',contendersRecord.id),b=child('retry',contendersRecord.id)
    await Promise.all([record(a,'ready'),record(b,'ready')]);release(a);release(b)
    assert.deepEqual((await Promise.all([result(a),result(b)])).map(value=>value.status).sort(),['conflict','scheduled'])
    await outgoing.dispatchOnce(publisher)
    // This accepted remote send is reported as failure, then deliberately retried under the original ID.
    const ambiguous=await outgoing.enqueue({secret:'immutable remote intent'},{maxAttempts:1})
    assert.equal((await outgoing.dispatchOnce({async publish(message,context){await publisher.publish(message,context);throw new Error('owned lost acceptance response')}})).status,'failed')
    assert.equal((await outgoing.retryFailed(ambiguous.id,{expectedMaxAttempts:1,additionalAttempts:1})).status,'scheduled')
    assert.equal((await outgoing.dispatchOnce(publisher)).status,'succeeded')
    const receipts=await waitFor(async()=>{const value=await json(broker,'/effects');return value.deliveries.filter(row=>row.id===ambiguous.id).length>=2?value:undefined})
    assert.equal(receipts.effects.filter(row=>row.id===ambiguous.id).length,1)
    assert.equal(new Set(receipts.deliveries.filter(row=>row.id===ambiguous.id).map(row=>row.broker_id)).size,2)
    for(let i=0;i<4;i++)await failed()
    const first=await outgoing.list({limit:2}),second=await outgoing.list({limit:2,after:first.nextCursor})
    assert.equal(first.deliveries.length,2);assert.equal(second.deliveries.length,2);assert.equal(second.nextCursor,null)
    assert.equal(new Set([...first.deliveries,...second.deliveries].map(value=>value.id)).size,4)
    assert.ok(!/payload|leaseToken|private recovery/.test(JSON.stringify([first,second])))
    await assert.rejects(outgoing.list({state:'pending',after:first.nextCursor}),/cursor/)
    // Only this failed row is eligible for the cleanup race; remove other failures with the maintenance credential.
    const maintenance=pg?await openPostgres({connectionString:maintenanceEnvironment.LONGHORN_RECOVERY_URL}):database
    const maintained=new Outbox({name,schema,store:pg?new PostgresOutboxStore(maintenance):new SqliteOutboxStore(maintenance)})
    try{await maintained.prune({before:Date.now(),includeFailed:true,limit:100})}finally{await maintained.close();if(pg)await maintenance.close()}
    const raced=await failed(),retry=child('retry',raced.id),prune=child('prune',raced.id,1,maintenanceEnvironment)
    await Promise.all([record(retry,'ready'),record(prune,'ready')]);release(retry);release(prune)
    const [retried,removed]=await Promise.all([result(retry),result(prune)]),current=await outgoing.get(raced.id)
    if(retried.status==='scheduled'){assert.equal(removed,0);assert.equal(current.state,'pending');await outgoing.dispatchOnce(publisher)}
    else{assert.equal(retried.status,'missing');assert.equal(removed,1);assert.equal(current,undefined)}
  }finally{await outgoing.close()}
}
try{
  await build({entry:{broker:join(root,'scripts/fixtures/outbox-broker.mjs'),worker:join(root,'scripts/fixtures/outbox-recovery-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,silent:true})
  const broker=await make(join(temporary,'bundle/broker.js'),{queueProducers:{MESSAGES:'recovery-broker'},queueConsumers:{'recovery-broker':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},durableObjects:{RECEIPTS:{className:'BrokerReceipts',useSQLite:true}},durableObjectsPersist:join(temporary,'broker')})
  const filename=join(temporary,'recovery.sqlite'),sqlite=await openSqlite({filename});databases.push(sqlite)
  await migrate(sqlite,[...queueMigrations,...outboxMigrations]);await migrate(sqlite,[...queueMigrations,...outboxMigrations,...outboxRecoveryMigrations])
  const sqliteEnv={LONGHORN_RECOVERY_FILE:filename};await driver(sqlite,false,sqliteEnv,sqliteEnv,broker)
  console.log('SQLite recovery: legacy history upgrade, independent before-commit visibility/SIGKILL rollback, committed retry after SIGKILL, competing operator processes, retry/prune race, bounded metadata pages and stable-ID real-broker redelivery verified.')
  sandbox=await startPostgresSandbox();const pg=await openPostgres({connectionString:sandbox.appUrl}),owner=await openPostgres({connectionString:sandbox.ownerUrl});databases.push(pg,owner)
  await migratePostgres(owner,[...postgresExampleMigrations,...postgresOutboxMigrations],{schema:'longhorn_pg_example'})
  await migratePostgres(owner,[...postgresExampleMigrations,...postgresOutboxMigrations,...postgresOutboxRecoveryMigrations],{schema:'longhorn_pg_example'})
  await driver(pg,true,{LONGHORN_RECOVERY_PROVIDER:'postgres',LONGHORN_RECOVERY_URL:sandbox.appUrl},{LONGHORN_RECOVERY_PROVIDER:'postgres',LONGHORN_RECOVERY_URL:sandbox.ownerUrl},broker)
  console.log('PostgreSQL recovery: restricted-role conditional retries and pages, real process contention/SIGKILL and maintenance race, existing DML grants, original message ID with two broker deliveries/one effect verified.')
  const configuration={queueProducers:{MESSAGES:'object-recovery'},queueConsumers:{'object-recovery':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},durableObjects:{COMMANDS:{className:'RecoveryCommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}},durableObjectsPersist:join(temporary,'object')}
  let example=await make(join(temporary,'bundle/worker.js'),{...configuration,bindings:{OUTBOX_OPERATIONS_TOKEN:token,ABORT_RETRY_COMMIT:true}})
  await json(example,'/health');let state=await json(example,'/_fixture/state')
  assert.ok(state.history.some(migration=>migration.id==='longhorn_outbox/002_inspection'));assert.equal(state.jobs[0].state,'failed')
  const id=state.seed.id,commandId=state.seed.commandId,route='/operations/deliveries/'+id+'/retry'
  assert.equal((await example.dispatchFetch('http://recovery.example/operations/deliveries')).status,401)
  assert.equal((await example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1},'x'.repeat(64)))).status,401)
  assert.equal((await example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1,unexpected:true},token))).status,400)
  const inspected=await json(example,'/operations/deliveries?state=failed&limit=1',auth);assert.equal(inspected.deliveries[0].id,id)
  assert.ok(!JSON.stringify(inspected).includes(token))
  assert.deepEqual(Object.keys(inspected.deliveries[0]).sort(),['id','queue','state','attempts','maxAttempts','availableAt','createdAt','updatedAt','leaseUntil','lastFailure'].sort())
  const exhausted=await example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1,additionalAttempts:100},token));assert.equal(exhausted.status,409)
  assert.equal((await exhausted.json()).error,'Attempt ceiling cannot exceed 100')
  const oldBoot=state.boot,aborted=await example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1,additionalAttempts:1},token));assert.notEqual(aborted.status,202)
  state=await json(example,'/_fixture/state');assert.notEqual(state.boot,oldBoot);assert.equal(state.jobs[0].state,'failed');assert.equal(state.jobs[0].max_attempts,1);assert.equal(state.alarm,null)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),{...configuration,bindings:{OUTBOX_OPERATIONS_TOKEN:token}})
  const retries=await Promise.all([1,2].map(()=>example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1,additionalAttempts:1,delayMs:50},token))))
  assert.deepEqual(retries.map(value=>value.status).sort(),[202,409]);const accepted=await retries.find(value=>value.status===202).json();assert.equal(accepted.delivery.id,id);assert.equal(accepted.delivery.attempts,1)
  state=await waitFor(async()=>{const value=await json(example,'/_fixture/state');return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.equal(state.jobs[0].attempts,2);assert.deepEqual(state.sent,[id,id])
  const receipt=await waitFor(async()=>{const response=await example.dispatchFetch('http://recovery.example/receipts/'+commandId);return response.ok?response.json():undefined})
  assert.equal(receipt.receipts.length,1);assert.equal(receipt.receipts[0].messageId,id);assert.equal(receipt.receipts[0].result.sum,8)
  assert.equal((await example.dispatchFetch('http://recovery.example'+route,post({expectedMaxAttempts:1},token))).status,409)
  assert.equal((await example.dispatchFetch('http://recovery.example/operations/deliveries?after=bad',auth)).status,400)
  const created=[]
  for(let i=0;i<3;i++)created.push(await json(example,'/commands',post({id:'cursor-'+i,numbers:[i+10]})))
  await waitFor(async()=>{const value=await json(example,'/operations/deliveries?state=succeeded',auth);return value.deliveries.length===4})
  const seen=[],firstPage=await json(example,'/operations/deliveries?state=succeeded&limit=1',auth)
  seen.push(...firstPage.deliveries.map(value=>value.id));let afterCursor=firstPage.nextCursor
  assert.equal(typeof afterCursor,'string')
  while(afterCursor){const page=await json(example,'/operations/deliveries?state=succeeded&limit=1&after='+encodeURIComponent(afterCursor),auth);seen.push(...page.deliveries.map(value=>value.id));afterCursor=page.nextCursor}
  assert.deepEqual([...seen].sort(),[id,...created.map(value=>value.delivery.id)].sort())
  assert.equal((await example.dispatchFetch('http://recovery.example/operations/deliveries?state=failed&after='+firstPage.nextCursor,auth)).status,400)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),configuration)
  assert.equal((await example.dispatchFetch('http://recovery.example/operations/deliveries',auth)).status,404)
  assert.deepEqual(await json(example,'/receipts/'+commandId),receipt)
  console.log('Object recovery: prior command history/data upgrade; configured operations authorization/validation, actual retry+alarm abort rollback, one competing retry, automatic native redelivery under original ID, one receipt and disabled routes/restart persistence verified.')
  const host=launch('scripts/serve-outbox-worker.mjs',{HOST:'127.0.0.1',PORT:'0',OUTBOX_DATA_PATH:join(temporary,'host'),OUTBOX_OPERATIONS_TOKEN:token})
  const address=(await waitFor(()=>host.records.find(value=>value.message==='HTTP server listening'))).fields.url
  assert.equal((await fetch(address+'/operations/deliveries')).status,401);assert.equal((await fetch(address+'/operations/deliveries',auth)).status,200)
  assert.equal((await end(host,'SIGTERM')).code,0,host.output());assert.ok(!host.output().includes(token))
  console.log('Local operations host: opt-in token binding, unauthorized/authorized TCP inspection, secret-free output and signal disposal verified.')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const disposed=await Promise.allSettled(workers.map(worker=>worker.dispose())),closed=await Promise.allSettled(databases.map(database=>database.close()))
  try{await sandbox?.stop()}finally{await rm(temporary,{recursive:true,force:true})}
  const errors=[...disposed,...closed].filter(value=>value.status==='rejected').map(value=>value.reason);if(errors.length)throw new AggregateError(errors,'Owned recovery cleanup failed')
}
