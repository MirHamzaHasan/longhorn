import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { Idempotency } from '../packages/idempotency/dist/index.js'
import { IdempotencyCleanup } from '../packages/idempotency/dist/cleanup.js'
import { SqliteIdempotencyStore,idempotencyMigrations } from '../packages/idempotency/dist/sqlite.js'
import { PostgresIdempotencyStore } from '../packages/idempotency/dist/postgres.js'
import { migrate } from '../packages/database/dist/index.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { PgRequestCleanup } from '../examples/postgres/dist/operations.js'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-cleanup-')),handles=[],cleaners=[],runtimeProof=[],password='owned cleanup account password',origin='http://127.0.0.1:3037'
let broker,sandbox,app,writing,releaseWriter,locking,releaseTable
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
const waitFor=async test=>{const end=Date.now()+20000;while(Date.now()<end){const result=await test();if(result)return result;await sleep(10)}throw new Error('Request cleanup condition did not settle')}
async function run(binary,args){
  const child=spawn(binary,args,{cwd:root,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});const ended=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}))}),timer=setTimeout(()=>child.kill('SIGKILL'),15000)
  try{assert.equal((await ended).code,0,output);const line=output.trim().split('\n').findLast(value=>value.startsWith('{"runtime":'));assert.ok(line,output);return JSON.parse(line)}finally{clearTimeout(timer)}
}
const connect=async options=>{const db=await openPostgres(options);handles.push(db);return db}
const ownCleanup=(requests,options)=>{const cleanup=new IdempotencyCleanup(requests,options);cleaners.push(cleanup);return cleanup}
try{
  const fixture=join(root,'scripts/fixtures/cleanup-native.mjs')
  runtimeProof.push(await run(process.execPath,[fixture,join(temporary,'node.sqlite')]));runtimeProof.push(await run(join(root,'node_modules/bun-runtime/bin/bun.exe'),[fixture,join(temporary,'bun.sqlite')]));runtimeProof.push(await run(join(root,'node_modules/deno-runtime/deno'),['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-read='+temporary+','+join(root,'runtimes/deno/dist')+','+join(root,'packages/database/dist'),'--allow-write='+temporary,fixture,join(temporary,'deno.sqlite')]))
  await build({entry:{worker:join(root,'scripts/fixtures/cleanup-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,clean:true,silent:true})
  const scriptPath=join(temporary,'bundle/worker.js');broker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE)});await broker.ready;const response=await broker.dispatchFetch('http://cleanup.example/contract',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);runtimeProof.push(await response.json());await broker.dispose();broker=undefined
  assert.deepEqual(runtimeProof.map(row=>row.runtime),['node','bun','deno','workerd']);assert.ok(runtimeProof.every(row=>row.singleFlight&&row.closeDrained&&row.observerFailure))
  assert.ok(runtimeProof.slice(0,3).every(row=>row.sqlite))
  console.log('Cleanup runtime contract: actual Node/Bun/Deno/workerd execution, serial bounds, recovery, reentrant drain and observer ownership verified; workerd invocation is finite.')
  const sqlite=await openSqlite({filename:join(temporary,'cleanup.sqlite')});handles.push(sqlite);await migrate(sqlite,idempotencyMigrations);let clock=100,effects=0
  const short=new Idempotency({store:new SqliteIdempotencyStore(sqlite),retentionMs:10,now:()=>clock}),long=new Idempotency({store:new SqliteIdempotencyStore(sqlite),retentionMs:1000,now:()=>clock})
  for(let i=0;i<3;i++)await short.run({scope:'cleanup:sqlite',key:'expired-'+i,input:i},async()=>{effects++;return i})
  await long.run({scope:'cleanup:sqlite',key:'live',input:99},async()=>{effects++;return 99});clock=200
  const sqliteCleanup=ownCleanup(short,{limit:2,intervalMs:10});sqliteCleanup.start();await waitFor(()=>sqliteCleanup.snapshot().removed===3);await sqliteCleanup.close();assert.ok(sqliteCleanup.snapshot().runs>=2)
  assert.equal((await long.run({scope:'cleanup:sqlite',key:'live',input:99},async()=>{effects++;return 99})).replayed,true);assert.equal(effects,4);assert.equal((await short.run({scope:'cleanup:sqlite',key:'expired-0',input:7},async()=>{effects++;return 7})).replayed,false);assert.equal(effects,5)
  console.log('Cleanup SQLite: actual serial bounded deletion, live replay preservation and explicit expired-key reexecution verified.')
  sandbox=await startAccountOperationsSandbox();const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl}),batches=[]
  let cleanup,closedDatabase=0,observedErrors=0
  const make=(enabled=false)=>createPostgresApp({openDatabase:async()=>{const value=await openPostgres({connectionString:sandbox.appUrl}),execute=value.execute.bind(value),close=value.close.bind(value);value.execute=async statement=>{const result=await execute(statement),sql=typeof statement==='string'?statement:statement.sql;if(sql.startsWith('WITH expired AS'))batches.push(result.rowsAffected);return result};value.close=async()=>{if(cleanup)assert.equal(cleanup.snapshot().state,'closed');closedDatabase++;await close()};return value},workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:enabled?{requestCleanup:{limit:2,intervalMs:20,onError:()=>{observedErrors++}}}:{}})
  app=make();let url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url;assert.throws(()=>app.container.resolve(PgRequestCleanup))
  const request=(path,body,cookie)=>fetch(url+'/account'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)})
  assert.equal((await request('/register',{username:'cleanup.alice',password})).status,201);const login=await request('/login',{username:'cleanup.alice',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],actor=(await login.json()).user.id,commandScope='user:'+actor+':numbers-command:v1',viewScope='user:'+actor+':history-view:create:v1',commands=[]
  for(let i=0;i<3;i++){const input={id:'cleanup-command-'+i,numbers:[2,5]},response=await request('/commands',input,cookie);assert.equal(response.status,201);commands.push({input,value:await response.json()})}
  const views=[];for(let i=0;i<2;i++){const input={id:crypto.randomUUID(),name:'Retained view '+i,selection:{scope:'mine',state:'all'}},response=await request('/history-views',input,cookie);assert.equal(response.status,201);views.push((await response.json()).view)}
  await owner.execute({sql:'UPDATE longhorn_idempotency.requests SET expires_at=0 WHERE (scope=$1 AND request_key IN($2,$3)) OR (scope=$4 AND request_key IN($5,$6))',args:[commandScope,commands[0].input.id,commands[1].input.id,viewScope,views[0].id,views[1].id]})
  const expired=async()=>Number((await db.execute({sql:'SELECT count(*) AS total FROM longhorn_idempotency.requests WHERE expires_at<=$1',args:[Date.now()]})).rows[0].total)
  await sleep(50);assert.equal(await expired(),4);await app.close();app=undefined;assert.equal(batches.length,0)
  await owner.execute('REVOKE DELETE ON longhorn_idempotency.requests FROM longhorn_app');try{app=make(true);await assert.rejects(app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0}),/cleanup requires/);await app.close();app=undefined;assert.equal(batches.length,0)}finally{await owner.execute('GRANT DELETE ON longhorn_idempotency.requests TO longhorn_app')}
  app=make(true);url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url;cleanup=app.container.resolve(PgRequestCleanup);await waitFor(async()=>await expired()===0);assert.equal(cleanup.snapshot().removed,4);assert.ok(batches.length>=2&&batches.every(n=>n<=2))
  const live=await request('/commands',commands[2].input,cookie);assert.equal(live.headers.get('idempotency-replayed'),'true');assert.deepEqual(await live.json(),commands[2].value);assert.deepEqual((await(await request('/history-views',undefined,cookie)).json()).views,views)
  assert.equal((await db.execute('SELECT count(*)::integer AS total FROM longhorn_pg_example.operator_commands')).rows[0].total,3);assert.equal((await db.execute('SELECT count(*)::integer AS total FROM longhorn_queue.jobs')).rows[0].total,3);assert.equal((await db.execute('SELECT count(*)::integer AS total FROM longhorn_outbox.recovery_audit')).rows[0].total,0)
  await owner.execute('REVOKE DELETE ON longhorn_idempotency.requests FROM longhorn_app');try{await waitFor(()=>cleanup.snapshot().errors>=2);assert.ok(observedErrors>=2);assert.equal((await fetch(url+'/readyz')).status,503);assert.equal((await request('/commands',undefined,cookie)).status,200)}finally{await owner.execute('GRANT DELETE ON longhorn_idempotency.requests TO longhorn_app')}
  await waitFor(async()=>(await fetch(url+'/readyz')).status===200)
  const recoveredSnapshot=cleanup.snapshot();await app.close();app=undefined
  const requests=new Idempotency({store:new PostgresIdempotencyStore(db)}),race={scope:'cleanup:held',key:'generation',input:0};await requests.run(race,async()=>({generation:0}));await owner.execute({sql:'UPDATE longhorn_idempotency.requests SET expires_at=0 WHERE scope=$1 AND request_key=$2',args:[race.scope,race.key]});let entered=false;const gate=new Promise(done=>{releaseWriter=done});writing=requests.run({...race,input:1},async()=>{entered=true;await gate;return{generation:1}});await waitFor(()=>entered)
  const raceCleanup=ownCleanup(requests,{limit:2,intervalMs:20});raceCleanup.start();await waitFor(()=>raceCleanup.snapshot().runs>=2&&!raceCleanup.snapshot().active);assert.equal((await db.execute({sql:'SELECT count(*)::integer AS total FROM longhorn_idempotency.requests WHERE scope=$1 AND request_key=$2',args:[race.scope,race.key]})).rows[0].total,1);releaseWriter();await writing;writing=undefined;await raceCleanup.close();assert.equal((await requests.run({...race,input:1},async()=>{throw new Error('Renewed response was lost')})).replayed,true)
  const beforeClosed=closedDatabase;cleanup=undefined;app=make(true);url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url;cleanup=app.container.resolve(PgRequestCleanup)
  let tableHeld=false,lockPid;const tableGate=new Promise(done=>{releaseTable=done});locking=owner.transaction(async tx=>{lockPid=(await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid;await tx.execute('LOCK TABLE longhorn_idempotency.requests IN ACCESS EXCLUSIVE MODE');tableHeld=true;await tableGate});await waitFor(()=>tableHeld);await waitFor(async()=>(await db.execute({sql:'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting',args:[lockPid]})).rows[0].waiting===true)
  let closed=false,closeError;const closing=app.close().then(()=>{closed=true},error=>{closed=true;closeError=error});await waitFor(()=>cleanup.snapshot().state==='closing');await sleep(30);assert.equal(closed,false);assert.equal(closedDatabase,beforeClosed);releaseTable();await locking;locking=undefined;await closing;if(closeError)throw closeError;assert.equal(cleanup.snapshot().state,'closed');assert.equal(closedDatabase,beforeClosed+1);app=undefined
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/request-cleanup-proof.json',JSON.stringify({runtimes:runtimeProof,sqlite:{removed:3,livePreserved:true,expiredMayReexecute:true},postgres:{expiredRemoved:4,limit:2,liveCommandPreserved:true,businessRowsPreserved:true,lockedGenerationPreserved:true,permissionRecovery:true,closeBeforeDatabase:true},recoveredSnapshot,drainedSnapshot:cleanup.snapshot()},null,2))
  console.log('Cleanup PostgreSQL/application: opt-in only, startup grants, command/view scope pruning, bounded batches, live replay/business preservation, permission failure/recovery, held replacement and real SQL drain before database close verified.')
}finally{releaseWriter?.();await writing?.catch(()=>{});releaseTable?.();await locking?.catch(()=>{});await app?.close();for(const cleaner of cleaners)await cleaner.close().catch(()=>{});await broker?.dispose();for(const db of handles.reverse())await db.close();await sandbox?.stop();await rm(temporary,{recursive:true,force:true})}
