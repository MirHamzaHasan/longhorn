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
import { SqliteOutboxStore,outboxMigrations,outboxRecoveryMigrations,outboxAuditMigrations } from '../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore,postgresOutboxMigrations,postgresOutboxRecoveryMigrations,postgresOutboxAuditMigrations } from '../packages/outbox/dist/postgres.js'
import { queueMigrations } from '../packages/queue/dist/sqlite.js'
import { postgresExampleMigrations } from '../examples/postgres/dist/migrations.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-outbox-audit-')),children=[],workers=[],databases=[];let sandbox
const token=randomBytes(32).toString('hex'),rotated=randomBytes(32).toString('hex'),actor='service:native-operator',schema={'~standard':{version:1,vendor:'native-audit',validate:value=>({value})}}
const reject={async publish(){throw new Error('owned failure')}},request={actor:'operator:native',reason:'provider-restored',expectedMaxAttempts:1,additionalAttempts:1}
const post=(body,credential)=>({method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
const auth=credential=>({headers:{Authorization:'Bearer '+credential}})
const waitFor=async predicate=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Outbox audit condition did not settle')}
function launch(script,env){const child=spawn(process.execPath,[join(root,script)],{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}});child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance}
const record=(instance,stage)=>waitFor(()=>{const found=instance.records.find(value=>value.stage===stage);if(found)return found;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());return false})
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
async function make(scriptPath,extra={}){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),...extra});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://audit.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
async function driver(database,pg,environment,maintenance){
  const name=pg?'audit.postgres.v1':'audit.sqlite.v1',outgoing=new Outbox({name,schema,store:pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database),retryDelayMs:0})
  const child=(mode,id)=>launch('scripts/fixtures/outbox-audit-process.mjs',{...environment,LONGHORN_AUDIT_NAME:name,LONGHORN_AUDIT_MODE:mode,LONGHORN_AUDIT_ID:id})
  const release=instance=>instance.child.stdin.write('go\n')
  const failed=async()=>{const value=await outgoing.enqueue({secret:'private audit payload'},{maxAttempts:1});await outgoing.dispatchOnce(reject);return value}
  try{
    const original=await failed(),before=child('before-commit',original.id);await record(before,'ready');release(before);await record(before,'before-commit')
    assert.equal((await outgoing.get(original.id)).state,'failed');assert.equal((await outgoing.auditHistory()).records.length,0)
    assert.equal((await end(before,'SIGKILL')).signal,'SIGKILL');assert.equal((await outgoing.get(original.id)).maxAttempts,1);assert.equal((await outgoing.auditHistory()).records.length,0)
    const after=child('after-commit',original.id);await record(after,'ready');release(after);const committed=(await record(after,'result')).value
    assert.equal(committed.result.status,'scheduled');assert.equal((await end(after,'SIGKILL')).signal,'SIGKILL')
    assert.equal((await outgoing.get(original.id)).state,'pending');assert.equal((await outgoing.auditHistory()).records[0].id,committed.audit.id)
    await outgoing.dispatchOnce({async publish(){}})
    const contended=await failed(),a=child('retry',contended.id),b=child('retry',contended.id)
    await Promise.all([record(a,'ready'),record(b,'ready')]);release(a);release(b)
    const results=await Promise.all([a,b].map(async instance=>{const value=(await record(instance,'result')).value;assert.equal((await end(instance)).code,0,instance.output());return value}))
    assert.deepEqual(results.map(value=>value.result.status).sort(),['conflict','scheduled'])
    assert.deepEqual((await outgoing.auditHistory({deliveryId:contended.id})).records.map(value=>value.outcome).sort(),['conflict','scheduled'])
    await outgoing.dispatchOnce({async publish(){}})
    if(pg){
      const denied=await failed();await maintenance.execute('REVOKE INSERT ON longhorn_outbox.recovery_audit FROM longhorn_app')
      try{await assert.rejects(outgoing.retryFailedAudited(denied.id,request),error=>error.code==='42501')}finally{await maintenance.execute('GRANT INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')}
      assert.equal((await outgoing.get(denied.id)).maxAttempts,1);assert.equal((await outgoing.get(denied.id)).state,'failed');assert.equal((await outgoing.auditHistory({deliveryId:denied.id})).records.length,0)
      assert.equal((await outgoing.retryFailedAudited(denied.id,request)).result.status,'scheduled');await outgoing.dispatchOnce({async publish(){}})
      await assert.rejects(database.execute("UPDATE longhorn_outbox.recovery_audit SET actor='forbidden'"),error=>error.code==='42501')
      await assert.rejects(outgoing.pruneAudit({before:Date.now()}),error=>error.code==='42501')
    }
    await outgoing.retryFailedAudited('missing-one',request);await outgoing.retryFailedAudited('missing-two',request)
    const first=await outgoing.auditHistory({limit:2}),seen=[...first.records];let cursor=first.nextCursor
    while(cursor){const page=await outgoing.auditHistory({limit:2,after:cursor});seen.push(...page.records);cursor=page.nextCursor}
    assert.equal(new Set(seen.map(value=>value.id)).size,seen.length);assert.ok(seen.length>=5)
    assert.ok(!JSON.stringify(seen).includes('private audit payload'));assert.ok(seen.every(value=>!Object.hasOwn(value,'payload')&&!Object.hasOwn(value,'leaseToken')))
    const maintained=new Outbox({name,schema,store:pg?new PostgresOutboxStore(maintenance):new SqliteOutboxStore(database)})
    try{await maintained.prune({before:Date.now(),includeFailed:true});assert.equal((await outgoing.auditHistory()).records.length,seen.length)
      const missing=await outgoing.retryFailedAudited(original.id,{...request,expectedMaxAttempts:2});assert.equal(missing.result.status,'missing')
      const count=(await outgoing.auditHistory()).records.length;assert.equal(await maintained.pruneAudit({before:Date.now(),limit:1}),1);assert.equal((await outgoing.auditHistory()).records.length,count-1)
    }finally{await maintained.close()}
  }finally{await outgoing.close()}
}
try{
  const filename=join(temporary,'audit.sqlite'),sqlite=await openSqlite({filename});databases.push(sqlite)
  const legacy=[...queueMigrations,...outboxMigrations,...outboxRecoveryMigrations]
  await migrate(sqlite,legacy);await migrate(sqlite,[...legacy,...outboxAuditMigrations])
  await driver(sqlite,false,{LONGHORN_AUDIT_FILE:filename},sqlite)
  console.log('SQLite audit: legacy upgrade, native retry+audit visibility/SIGKILL rollback and retained commit, competing actions, per-delivery/global pages, history after job deletion and bounded audit retention verified.')
  sandbox=await startPostgresSandbox();const pg=await openPostgres({connectionString:sandbox.appUrl}),owner=await openPostgres({connectionString:sandbox.ownerUrl});databases.push(pg,owner)
  const pgLegacy=[...postgresExampleMigrations,...postgresOutboxMigrations,...postgresOutboxRecoveryMigrations]
  await migratePostgres(owner,pgLegacy,{schema:'longhorn_pg_example'});await migratePostgres(owner,[...pgLegacy,...postgresOutboxAuditMigrations],{schema:'longhorn_pg_example'})
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')
  await driver(pg,true,{LONGHORN_AUDIT_PROVIDER:'postgres',LONGHORN_AUDIT_URL:sandbox.appUrl},owner)
  // Prove audit maintenance needs only its dedicated SELECT/DELETE, without queue mutation or audit UPDATE.
  const admin=await openPostgres({connectionString:sandbox.connectionString});databases.push(admin)
  const password=randomBytes(24).toString('hex')
  await admin.execute("CREATE ROLE longhorn_audit_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+password+"'")
  await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_audit_maintenance')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_audit_maintenance');await owner.execute('GRANT SELECT,DELETE ON longhorn_outbox.recovery_audit TO longhorn_audit_maintenance')
  const maintenanceUrl=new URL(sandbox.appUrl);maintenanceUrl.username='longhorn_audit_maintenance';maintenanceUrl.password=password
  const minimal=await openPostgres({connectionString:maintenanceUrl.href});databases.push(minimal)
  const maintained=new Outbox({name:'audit.postgres.v1',schema,store:new PostgresOutboxStore(minimal)})
  try{assert.equal(await maintained.pruneAudit({before:Date.now(),limit:1}),1);await assert.rejects(minimal.execute("UPDATE longhorn_outbox.recovery_audit SET actor='forbidden'"),error=>error.code==='42501')}finally{await maintained.close()}
  console.log('PostgreSQL audit: restricted SELECT/INSERT append role, missing-INSERT rollback, process contention/interruption and independent history; UPDATE/DELETE denied to runtime, dedicated SELECT/DELETE-only maintenance verified.')
  await build({entry:{worker:join(root,'scripts/fixtures/outbox-audit-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,silent:true})
  const config={queueProducers:{MESSAGES:'audit-messages'},queueConsumers:{'audit-messages':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},durableObjects:{COMMANDS:{className:'AuditedCommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}},durableObjectsPersist:join(temporary,'objects')}
  let example=await make(join(temporary,'bundle/worker.js'),{...config,bindings:{OUTBOX_OPERATIONS_TOKEN:token,OUTBOX_OPERATIONS_ACTOR:actor,ABORT_RETRY_COMMIT:true}})
  await json(example,'/health');let state=await json(example,'/_fixture/state');assert.equal(state.history.at(-1).id,'longhorn_outbox/003_audit');assert.equal(state.audits.length,0)
  const id=state.seed.id,commandId=state.seed.commandId,route='/operations/deliveries/'+id+'/retry'
  assert.equal((await example.dispatchFetch('http://audit.example/operations/audit')).status,401)
  assert.equal((await example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:1,actor:'forged'},token))).status,400)
  assert.equal((await example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:1,reason:'raw-secret-value'},token))).status,400)
  assert.equal((await json(example,'/operations/audit',auth(token))).records.length,0)
  const oldBoot=state.boot,aborted=await example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:1,additionalAttempts:1,reason:'provider-restored'},token));assert.notEqual(aborted.status,202)
  state=await json(example,'/_fixture/state');assert.notEqual(state.boot,oldBoot);assert.equal(state.jobs[0].state,'failed');assert.equal(state.jobs[0].max_attempts,1);assert.equal(state.audits.length,0);assert.equal(state.alarm,null)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),{...config,bindings:{OUTBOX_OPERATIONS_TOKEN:token,OUTBOX_OPERATIONS_ACTOR:actor}})
  const responses=await Promise.all(['provider-restored','configuration-fixed'].map(reason=>example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:1,additionalAttempts:1,reason,delayMs:50},token))))
  assert.deepEqual(responses.map(value=>value.status).sort(),[202,409]);const results=await Promise.all(responses.map(value=>value.json()))
  assert.deepEqual(results.map(value=>value.audit.outcome).sort(),['conflict','scheduled']);assert.ok(results.every(value=>value.audit.actor===actor));assert.equal(new Set(results.map(value=>value.audit.id)).size,2)
  state=await waitFor(async()=>{const value=await json(example,'/_fixture/state');return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.deepEqual(state.sent,[id,id]);assert.equal(state.jobs[0].attempts,2)
  const receipt=await waitFor(async()=>{const response=await example.dispatchFetch('http://audit.example/receipts/'+commandId);return response.ok?response.json():undefined});assert.equal(receipt.receipts.length,1)
  assert.equal((await json(example,'/_fixture/prune-job',post({}))).removed,1)
  assert.equal((await json(example,'/operations/audit?deliveryId='+id,auth(token))).records.length,2)
  const missing=await example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:2,reason:'manual-retry'},token));assert.equal(missing.status,404);assert.equal((await missing.json()).audit.outcome,'missing')
  const records=[],first=await json(example,'/operations/audit?limit=1',auth(token));records.push(...first.records);let after=first.nextCursor
  while(after){const page=await json(example,'/operations/audit?limit=1&after='+encodeURIComponent(after),auth(token));records.push(...page.records);after=page.nextCursor}
  assert.equal(records.length,3);assert.equal(new Set(records.map(value=>value.id)).size,3)
  assert.ok(records.every(value=>!Object.hasOwn(value,'payload')&&!Object.hasOwn(value,'leaseToken')));assert.ok(!JSON.stringify(records).includes(token));assert.ok(records.every(value=>value.actor===actor))
  assert.equal((await example.dispatchFetch('http://audit.example/operations/audit?deliveryId='+id+'&after='+first.nextCursor,auth(token))).status,400)
  assert.equal((await json(example,'/_fixture/prune-audit',post({}))).removed,1);const retained=await json(example,'/operations/audit',auth(token));assert.equal(retained.records.length,2)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),config);assert.equal((await example.dispatchFetch('http://audit.example/operations/audit',auth(token))).status,404)
  assert.deepEqual(await json(example,'/receipts/'+commandId),receipt)
  await dispose(example);example=await make(join(temporary,'bundle/worker.js'),{...config,bindings:{OUTBOX_OPERATIONS_TOKEN:rotated,OUTBOX_OPERATIONS_ACTOR:'service:rotated-operator'}})
  assert.equal((await example.dispatchFetch('http://audit.example/operations/audit',auth(token))).status,401);assert.deepEqual(await json(example,'/operations/audit',auth(rotated)),retained)
  const rotatedAction=await example.dispatchFetch('http://audit.example'+route,post({expectedMaxAttempts:2},rotated));assert.equal(rotatedAction.status,404);assert.equal((await rotatedAction.json()).audit.actor,'service:rotated-operator')
  console.log('Object audit: prior history upgrade, server-bound actor/reason policy, actual audit+retry+alarm abort rollback, one competing grant/two audits, stable-ID broker effect, live cursor history/retention and credential/actor rotation persistence verified.')
  const host=launch('scripts/serve-outbox-worker.mjs',{HOST:'127.0.0.1',PORT:'0',OUTBOX_DATA_PATH:join(temporary,'host'),OUTBOX_OPERATIONS_TOKEN:token,OUTBOX_OPERATIONS_ACTOR:'service:tcp-audit'})
  const url=(await waitFor(()=>host.records.find(value=>value.message==='HTTP server listening'))).fields.url
  assert.equal((await fetch(url+'/operations/audit')).status,401)
  const tcp=await fetch(url+'/operations/deliveries/'+crypto.randomUUID()+'/retry',post({expectedMaxAttempts:1},token));assert.equal(tcp.status,404);assert.equal((await tcp.json()).audit.actor,'service:tcp-audit')
  assert.equal((await(await fetch(url+'/operations/audit',auth(token))).json()).records.length,1)
  assert.equal((await end(host,'SIGTERM')).code,0,host.output());assert.ok(!host.output().includes(token));assert.ok(!host.output().includes(rotated))
  console.log('Local audit host: actor binding, authorized audit write/read over TCP, unauthorized denial, secret-free output and signal disposal verified.')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const disposed=await Promise.allSettled(workers.map(worker=>worker.dispose())),closed=await Promise.allSettled(databases.map(database=>database.close()))
  try{await sandbox?.stop()}finally{await rm(temporary,{recursive:true,force:true})}
  const errors=[...disposed,...closed].filter(value=>value.status==='rejected').map(value=>value.reason);if(errors.length)throw new AggregateError(errors,'Owned audit cleanup failed')
}
