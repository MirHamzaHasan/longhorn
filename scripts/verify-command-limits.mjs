import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir,writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { postgresCommandLimitMigrations } from '../examples/postgres/dist/command-limit-migrations.js'
import { checkOperationTables } from '../examples/postgres/dist/operations.js'
import { checkCommandLimitAccess } from '../examples/postgres/dist/command-limits.js'
import { checkOperatorRuntimeRole } from '../examples/postgres/dist/operator-runtime.js'
import { grantOperatorRuntime } from '../examples/postgres/dist/runtime-grants.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createLogger } from '../packages/logger/dist/index.js'
const origin='http://127.0.0.1:3027',password='owned command budget password',handles=[],apps=[],children=[],records=[]
let sandbox,time=100,release,locking
const sleep=ms=>new Promise(done=>setTimeout(done,ms)),waitFor=async action=>{const end=Date.now()+20000;while(Date.now()<end){if(await action())return;await sleep(10)}throw new Error('Command budget condition timed out')}
const connect=async options=>{const db=await openPostgres(options);handles.push(db);return db}
function migration(hold=false){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/command-history-migration.mjs',import.meta.url))],{env:{...process.env,HISTORY_OWNER_URL:sandbox.ownerUrl,HISTORY_HOLD_COMMIT:String(hold)},stdio:['pipe','pipe','pipe']}),lines=[]
  for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{try{lines.push(JSON.parse(line))}catch{}})
  child.once('error',()=>{});const value={child,lines,ended:new Promise(done=>child.once('close',(code,signal)=>done({code,signal})))};children.push(value);return value
}
const stage=(value,name)=>waitFor(()=>{if(value.lines.some(row=>row.stage===name))return true;if(value.child.exitCode!==null||value.child.signalCode!==null)throw new Error('Owned migration ended early');return false})
try{
  sandbox=await startPostgresSandbox();const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl}),previous=postgresOperationsMigrations.slice(0,postgresOperationsMigrations.findIndex(row=>row.id===postgresCommandLimitMigrations[0].id))
  assert.equal(previous.at(-1).id,'postgres_account_operations/005_history_views');await migratePostgres(owner,previous,{schema:'longhorn_pg_example'})
  await checkOperationTables(owner);await assert.rejects(checkCommandLimitAccess(owner));await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app');await checkOperatorRuntimeRole(db)
  const ledger=async()=>(await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows,before=await ledger(),held=migration(true)
  await stage(held,'before-commit');assert.equal((await owner.execute("SELECT pg_catalog.to_regclass('longhorn_rate_limit.buckets')::text AS name")).rows[0].name,null)
  held.child.kill('SIGKILL');assert.equal((await held.ended).signal,'SIGKILL');assert.deepEqual(await ledger(),before)
  const migrations=[migration(),migration()];await Promise.all(migrations.map(row=>stage(row,'migrated')));for(const row of migrations)assert.equal((await row.ended).code,0)
  assert.deepEqual(migrations.map(row=>row.lines.find(v=>v.stage==='migrated').added.length).sort(),[0,1]);assert.deepEqual((await ledger()).slice(0,before.length),before)
  await grantOperatorRuntime(owner,'longhorn_app');await checkCommandLimitAccess(db);await checkOperatorRuntimeRole(db)
  for(const [grant,revoke]of[
    ['GRANT DELETE ON longhorn_rate_limit.buckets TO longhorn_app','REVOKE DELETE ON longhorn_rate_limit.buckets FROM longhorn_app'],
    ['GRANT CREATE ON SCHEMA longhorn_rate_limit TO longhorn_app','REVOKE CREATE ON SCHEMA longhorn_rate_limit FROM longhorn_app'],
  ]){await owner.execute(grant);try{await assert.rejects(checkOperatorRuntimeRole(db),/restricted/)}finally{await owner.execute(revoke)}}
  const start=async(enabled=true)=>{
    const value=createPostgresApp({logger:createLogger({sink:record=>records.push(record)}),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:enabled?{commandLimits:{limit:2,windowMs:1000,now:()=>time}}:{}});apps.push(value)
    return{value,url:(await value.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url}
  }
  const first=await start(),peer=await start()
  const request=(path,{cookie,body,raw,method,base=first.url,requestOrigin=origin}={})=>fetch(base+path,{method:method??(body===undefined&&raw===undefined?'GET':'POST'),headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined&&raw===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},...(body===undefined&&raw===undefined?{}:{body:raw??JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
  const login=async username=>{const response=await request('/account/login',{body:{username,password}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0]}
  for(const username of['limits.alice','limits.bobby'])assert.equal((await request('/account/register',{body:{username,password}})).status,201)
  const alice=await login('limits.alice'),alicePeer=await login('limits.alice'),bob=await login('limits.bobby'),input={id:'limited-command',numbers:[4,8]}
  const count=async()=>(await owner.execute("SELECT (SELECT count(*) FROM longhorn_pg_example.operator_commands) AS commands,(SELECT count(*) FROM longhorn_queue.jobs WHERE queue='outbox.command.numbers.v1') AS outgoing,(SELECT count(*) FROM longhorn_idempotency.requests) AS replays")).rows[0]
  assert.equal((await request('/account/commands',{body:input})).status,401)
  assert.equal((await request('/account/commands',{cookie:alice,body:input,requestOrigin:'https://wrong.example'})).status,403)
  assert.equal((await request('/account/commands',{cookie:alice,raw:'x'.repeat(9000)})).status,413)
  assert.equal((await owner.execute('SELECT count(*)::integer AS total FROM longhorn_rate_limit.buckets')).rows[0].total,0)
  const accepted=await request('/account/commands',{cookie:alice,body:input});assert.equal(accepted.status,201);const original=await accepted.json()
  const replay=await request('/account/commands',{cookie:alicePeer,body:input,base:peer.url});assert.equal(replay.status,201);assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),original)
  const snapshot=await count();assert.deepEqual(Object.values(snapshot).map(Number),[1,1,1]);const blocked=await request('/account/commands',{cookie:alice,body:{id:'must-not-exist',numbers:[9]},base:peer.url});assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'1');assert.equal(blocked.headers.get('cache-control'),'no-store');assert.deepEqual(await count(),snapshot)
  for(const path of['/account/commands','/account/commands/'+original.command.id,'/account/session'])assert.equal((await request(path,{cookie:alice})).status,200)
  assert.equal((await request('/account/commands',{cookie:bob,raw:'{'})).status,400)
  assert.equal((await request('/account/commands',{cookie:bob,body:{}})).status,400)
  assert.equal((await request('/account/commands',{cookie:bob,body:input})).status,429);assert.deepEqual(await count(),snapshot)
  assert.equal((await request('/account/logout',{cookie:alice,body:{}})).status,204);const fresh=await login('limits.alice')
  assert.equal((await request('/account/commands',{cookie:fresh,body:input})).status,429)
  const rows=(await owner.execute('SELECT subject_hash,attempts FROM longhorn_rate_limit.buckets')).rows;assert.equal(rows.length,2);assert.ok(rows.every(row=>/^[a-f0-9]{64}$/.test(row.subject_hash)&&row.attempts===3))
  time=1100
  const later=await request('/account/commands',{cookie:fresh,body:input});assert.equal(later.status,201);assert.equal(later.headers.get('idempotency-replayed'),'true');assert.deepEqual(await later.json(),original);assert.deepEqual(await count(),snapshot)
  await owner.execute('REVOKE UPDATE ON longhorn_rate_limit.buckets FROM longhorn_app')
  try{
    const failed=await request('/account/commands',{cookie:bob,body:input});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'Request limit is unavailable'});assert.deepEqual(await count(),snapshot)
    await waitFor(async()=>(await request('/readyz')).status===503);await assert.rejects(checkCommandLimitAccess(db))
    const off=await start(false);assert.equal((await request('/account/commands',{cookie:bob,body:input,base:off.url})).status,201);await off.value.close()
  }finally{await owner.execute('GRANT UPDATE ON longhorn_rate_limit.buckets TO longhorn_app')}
  await waitFor(async()=>(await request('/readyz')).status===200)
  const recovered=await request('/account/commands',{cookie:bob,body:input});assert.equal(recovered.status,201);assert.equal(recovered.headers.get('idempotency-replayed'),'true')
  assert.ok(records.some(row=>row.message==='Command request limit unavailable'&&row.fields.reason==='store'))
  assert.ok(!records.filter(row=>row.message==='Command request limit unavailable').some(row=>JSON.stringify(row).includes('permission denied')))
  // A real row lock keeps the HTTP attempt, limiter and database alive through shutdown.
  let pid,owned=false;const gate=new Promise(done=>{release=done});locking=owner.transaction(async tx=>{pid=(await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid;await tx.execute("UPDATE longhorn_rate_limit.buckets SET attempts=attempts WHERE scope='account.commands.v1'");owned=true;await gate});await waitFor(()=>owned)
  const pending=request('/account/commands',{cookie:fresh,body:input});await waitFor(async()=>(await owner.execute({sql:'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS blocked',args:[pid]})).rows[0].blocked===true)
  let closed=false;const closing=first.value.close().then(()=>{closed=true});await sleep(30);assert.equal(closed,false);time=2100;release();await locking;locking=undefined
  assert.equal((await pending).status,201);await closing;assert.equal(closed,true)
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/command-limit-proof.json',JSON.stringify({previousProfileCompatible:true,originalLedgerPreserved:true,killedMigrationRollback:true,competingOwnersAdded:[0,1],minimalGrants:true,maintenanceDenied:true,sharedAccountsAndHosts:true,guardOrdering:true,invalidAndReplayCount:true,readsUnaffected:true,noBlockedEffects:true,sessionResetDoesNotRefill:true,expiryRetainsReplay:true,grantReadinessRecovery:true,disabledCompatible:true,nativeHttpSqlShutdownDrain:true},null,2)+'\n')
  console.log('Command limits: native upgrade rollback/race, restricted grants, two hosts/sessions, authenticated attempt ordering, 429/no effects, expiry/replay, 503/readiness recovery, default-off compatibility and held SQL/HTTP shutdown verified.')
}finally{
  release?.();await locking?.catch(()=>{});for(const row of children)if(row.child.exitCode===null&&row.child.signalCode===null){row.child.kill('SIGKILL');await row.ended}
  await Promise.all(apps.map(app=>app.close()));for(const db of handles.reverse())await db.close();await sandbox?.stop()
}
