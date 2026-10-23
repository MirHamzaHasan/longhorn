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
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { SqliteOutboxStore,outboxMigrations } from '../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore,postgresOutboxMigrations } from '../packages/outbox/dist/postgres.js'
import { queueMigrations } from '../packages/queue/dist/sqlite.js'
import { postgresExampleMigrations } from '../examples/postgres/dist/migrations.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-outbox-')),children=[],workers=[],databases=[];let sandbox
const schema={'~standard':{version:1,vendor:'outbox-native',validate:value=>({value})}}
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)})
const waitFor=async predicate=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Native outbox condition did not settle')}
function launch(script,env){const child=spawn(process.execPath,[join(root,script)],{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}});child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance}
const record=(instance,stage)=>waitFor(()=>{const found=instance.records.find(value=>value.stage===stage);if(found)return found;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());return false})
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
async function make(scriptPath,extra={}){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),...extra});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://outbox.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
async function driverProof(database,pg,environment,broker){
  const name=pg?'postgres.events.v1':'sqlite.events.v1',outbox=new Outbox({name,schema,store:pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database)})
  const brokerUrl=String(await broker.ready).replace(/\/$/,'')
  const process=(mode)=>launch('scripts/fixtures/outbox-process.mjs',{...environment,LONGHORN_OUTBOX_NAME:name,LONGHORN_OUTBOX_MODE:mode,LONGHORN_OUTBOX_BROKER:brokerUrl})
  const effects=()=>json(broker,'/effects')
  try{
    const producer=process('producer'),pending=await record(producer,'before-commit')
    assert.equal(await outbox.get(pending.delivery.id),undefined)
    const exists=async id=>(await database.execute(pg?{sql:'SELECT id FROM longhorn_pg_example.tasks WHERE id=$1::bigint',args:[id]}:{sql:'SELECT id FROM outbox_business WHERE id=?',args:[id]})).rows.length
    assert.equal(await exists(pending.id),0);assert.equal((await end(producer,'SIGKILL')).signal,'SIGKILL');assert.equal(await exists(pending.id),0)
    const seed=async()=>{const instance=process('producer'),value=await record(instance,'before-commit');instance.child.stdin.write('commit\n');await record(instance,'committed');assert.equal((await end(instance)).code,0,instance.output());return value}
    const before=await seed(),claim=process('before-send');const claimed=await record(claim,'claimed');assert.equal(claimed.message.id,before.delivery.id)
    assert.equal((await end(claim,'SIGKILL')).signal,'SIGKILL');assert.ok(!(await effects()).effects.some(value=>value.id===before.delivery.id))
    await waitFor(async()=>(await outbox.get(before.delivery.id)).leaseUntil<=Date.now())
    const recovered=process('send');const done=await record(recovered,'done');assert.equal(done.result.status,'succeeded',recovered.output());assert.equal((await end(recovered)).code,0,recovered.output())
    await waitFor(async()=>(await effects()).effects.some(value=>value.id===before.delivery.id))
    const after=await seed(),accepted=process('after-send');await record(accepted,'accepted')
    await waitFor(async()=>(await effects()).effects.some(value=>value.id===after.delivery.id));assert.equal((await end(accepted,'SIGKILL')).signal,'SIGKILL')
    await waitFor(async()=>(await outbox.get(after.delivery.id)).leaseUntil<=Date.now())
    const retry=process('send');assert.equal((await record(retry,'done')).result.status,'succeeded');assert.equal((await end(retry)).code,0,retry.output())
    const delivered=await waitFor(async()=>{const value=await effects();return value.deliveries.filter(row=>row.id===after.delivery.id).length>=2?value:undefined})
    assert.equal(delivered.effects.filter(row=>row.id===after.delivery.id).length,1)
    assert.equal(new Set(delivered.deliveries.filter(row=>row.id===after.delivery.id).map(row=>row.broker_id)).size,2)
    assert.equal((await outbox.get(after.delivery.id)).attempts,2)
    assert.equal((await outbox.get(after.delivery.id)).state,'succeeded')
    if(!pg){assert.equal(await outbox.prune({before:Date.now(),limit:1}),1);assert.equal(await outbox.prune({before:Date.now(),limit:1}),1)}
    else await assert.rejects(outbox.prune({before:Date.now()}),error=>error.code==='42501')
  }finally{await outbox.close()}
}
try{
  await build({entry:{broker:join(root,'scripts/fixtures/outbox-broker.mjs'),worker:join(root,'scripts/fixtures/outbox-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,silent:true})
  const broker=await make(join(temporary,'bundle/broker.js'),{queueProducers:{MESSAGES:'native-outbox'},queueConsumers:{'native-outbox':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},durableObjects:{RECEIPTS:{className:'BrokerReceipts',useSQLite:true}},durableObjectsPersist:join(temporary,'broker')})
  const filename=join(temporary,'outbox.sqlite'),sqlite=await openSqlite({filename});databases.push(sqlite)
  await migrate(sqlite,[...queueMigrations,...outboxMigrations,{id:'outbox_native/001',statements:['CREATE TABLE outbox_business(id INTEGER PRIMARY KEY,title TEXT NOT NULL) STRICT']}])
  await driverProof(sqlite,false,{LONGHORN_OUTBOX_FILE:filename},broker)
  console.log('SQLite outbox: native business/message visibility and producer SIGKILL rollback; dispatcher SIGKILL before send and after actual broker acceptance recovers with stable ID, duplicate broker deliveries and one SQL effect; bounded terminal cleanup verified.')
  sandbox=await startPostgresSandbox();const pg=await openPostgres({connectionString:sandbox.appUrl}),owner=await openPostgres({connectionString:sandbox.ownerUrl});databases.push(pg,owner)
  await migratePostgres(owner,[...postgresExampleMigrations,...postgresOutboxMigrations],{schema:'longhorn_pg_example'})
  await driverProof(pg,true,{LONGHORN_OUTBOX_PROVIDER:'postgres',LONGHORN_OUTBOX_URL:sandbox.appUrl},broker)
  const maintenance=new Outbox({name:'postgres.events.v1',schema,store:new PostgresOutboxStore(owner)})
  try{assert.equal(await maintenance.prune({before:Date.now(),limit:1}),1);assert.equal(await maintenance.prune({before:Date.now(),limit:1}),1)}finally{await maintenance.close()}
  console.log('PostgreSQL outbox: restricted-role transactional staging and real-broker crash/redelivery proofs; delivery needs existing queue DML, runtime DELETE stays denied, owner maintenance prunes bounded records.')
  const configuration={queueProducers:{MESSAGES:'worker-outbox'},queueConsumers:{'worker-outbox':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},durableObjects:{COMMANDS:{className:'FaultCommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}},durableObjectsPersist:join(temporary,'object')}
  let example=await make(join(temporary,'bundle/worker.js'),{...configuration,bindings:{CRASH_BEFORE_COMMIT:true}})
  await json(example,'/health');const initial=await json(example,'/_fixture/state')
  const failed=await example.dispatchFetch('http://outbox.example/commands',post({id:'rollback',numbers:[2,4]}));assert.notEqual(failed.status,201)
  const rolled=await json(example,'/_fixture/state');assert.notEqual(rolled.boot,initial.boot);assert.equal(rolled.commands.length,0);assert.equal(rolled.jobs.length,0);assert.equal(rolled.requests.length,0);assert.equal(rolled.alarm,null)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),{...configuration,bindings:{DISPATCH_ENABLED:false}})
  const created=await json(example,'/commands',post({id:'durable-command',numbers:[2,4,6]}));assert.equal((await json(example,'/deliveries/'+created.delivery.id)).delivery.state,'pending')
  assert.equal((await example.dispatchFetch('http://outbox.example/receipts/'+created.command.id)).status,404)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),{...configuration,bindings:{CRASH_AFTER_ACCEPT:true}})
  await json(example,'/health')
  const finished=await waitFor(async()=>{const value=await json(example,'/_fixture/state');return value.jobs[0]?.state==='succeeded'&&value.sent.length>=2?value:undefined})
  assert.equal(typeof finished.crashBoot,'string');assert.notEqual(finished.boot,finished.crashBoot);assert.equal(finished.jobs[0].attempts,2);assert.deepEqual(finished.sent,[created.delivery.id,created.delivery.id])
  const receipt=await waitFor(async()=>{const response=await example.dispatchFetch('http://outbox.example/receipts/'+created.command.id);return response.ok?response.json():undefined})
  assert.equal(receipt.receipts.length,1);assert.equal(receipt.receipts[0].messageId,created.delivery.id);assert.deepEqual(receipt.receipts[0].result,{count:3,sum:12,min:2,max:6})
  const replay=await example.dispatchFetch('http://outbox.example/commands',post({id:'durable-command',numbers:[2,4,6]}));assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),created)
  assert.equal((await example.dispatchFetch('http://outbox.example/commands',post({id:'durable-command',numbers:[99]}))).status,409)
  assert.equal((await example.dispatchFetch('http://outbox.example/commands',post({id:'bad',numbers:[]}))).status,400)
  assert.equal((await example.dispatchFetch('http://outbox.example/store',post({}))).status,404)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),configuration);assert.deepEqual(await json(example,'/receipts/'+created.command.id),receipt)
  console.log('Object outbox: actual precommit alarm interruption rolls back business/message/request/wakeup; pending message survives full host restart, automatic alarm publishes through real binding, reset after acceptance redelivers stable ID with one consumer receipt, replay/conflict and persisted result verified.')
  const host=launch('scripts/serve-outbox-worker.mjs',{HOST:'127.0.0.1',PORT:'0',OUTBOX_DATA_PATH:join(temporary,'host')})
  const address=(await waitFor(()=>host.records.find(value=>value.message==='HTTP server listening'))).fields.url
  const local=await fetch(address+'/commands',post({id:'local',numbers:[7,8]}));assert.equal(local.status,201);const value=await local.json()
  const result=await waitFor(async()=>{const response=await fetch(address+'/receipts/'+value.command.id);return response.ok?response.json():undefined});assert.equal(result.receipts[0].result.sum,15)
  assert.equal((await end(host,'SIGTERM')).code,0,host.output());assert.ok(host.records.some(value=>value.message==='Application stopped'))
  console.log('Local outbox launcher: automatic SQL-to-broker-to-receipt pipeline over TCP, explicit cold-host activation and awaited signal disposal verified.')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const disposed=await Promise.allSettled(workers.map(worker=>worker.dispose())),closed=await Promise.allSettled(databases.map(database=>database.close()))
  try{await sandbox?.stop()}finally{await rm(temporary,{recursive:true,force:true})}
  const errors=[...disposed,...closed].filter(value=>value.status==='rejected').map(value=>value.reason);if(errors.length)throw new AggregateError(errors,'Owned outbox cleanup failed')
}
