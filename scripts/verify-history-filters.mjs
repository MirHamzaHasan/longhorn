import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdir,writeFile } from 'node:fs/promises'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { postgresHistoryFilterMigrations,checkHistoryFilterIndexes } from '../examples/postgres/dist/history-filter-migrations.js'
import { PostgresCommandHistory } from '../examples/postgres/dist/command-history.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { AuthService } from '../packages/auth/dist/index.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { operationData,operationTopic } from '../examples/postgres/dist/operation-contracts.js'
const password='owned native filtered history password',queue='outbox.'+operationTopic,origin='http://127.0.0.1:3013',handles=[],children=[],secrets=[password]
let sandbox,app,outgoing,releasePublication,publishing
const waitFor=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('History filter condition did not settle')}
const connect=async options=>{const db=await openPostgres(options);handles.push(db);return db}
function migration(hold=false){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/command-history-migration.mjs',import.meta.url))],{env:{...process.env,HISTORY_OWNER_URL:sandbox.ownerUrl,HISTORY_HOLD_COMMIT:String(hold)},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned migration could not start\n'})
  const owned={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))};children.push(owned);return owned
}
async function stage(owned,name){return waitFor(()=>{const found=owned.records.find(value=>value.stage===name);if(found)return found;if(owned.child.exitCode!==null||owned.child.signalCode!==null)throw new Error('Owned migration ended before '+name);return false})}
async function finish(owned,signal){if(signal)owned.child.kill(signal);const timer=setTimeout(()=>owned.child.kill('SIGKILL'),15000);try{return await owned.ended}finally{clearTimeout(timer)}}
const decode=value=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))))
try{
  sandbox=await startPostgresSandbox();secrets.push(sandbox.ownerUrl,sandbox.appUrl)
  const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl})
  const previous=postgresOperationsMigrations.slice(0,-postgresHistoryFilterMigrations.length)
  assert.equal(previous.at(-1).id,'longhorn_postgres_auth/003_password_changes')
  await migratePostgres(owner,previous,{schema:'longhorn_pg_example'})
  const accounts=new AuthService(new PostgresAuthStore(owner),createScryptPasswordHasher()),store=new PostgresAuthStore(owner)
  const alice=await accounts.register('filters.alice',password),bob=await accounts.register('filters.bobby',password),operator=await accounts.register('filters.operator',password);await store.setUserRole('filters.operator','numbers-operator',true)
  const legacy=crypto.randomUUID();await owner.execute({sql:'INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers) VALUES($1,$2,$3::jsonb)',args:[legacy,alice.id,'[1]']})
  const before=(await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows
  const held=migration(true);await stage(held,'before-commit')
  assert.equal((await owner.execute("SELECT pg_catalog.to_regclass('longhorn_queue.command_history_state')::text AS name")).rows[0].name,null)
  assert.equal((await finish(held,'SIGKILL')).signal,'SIGKILL')
  assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows,before)
  const one=migration(),two=migration(),added=await Promise.all([stage(one,'migrated'),stage(two,'migrated')])
  for(const child of[one,two])assert.deepEqual(await finish(child),{code:0,signal:null})
  assert.deepEqual(added.map(value=>value.added.length).sort(),[0,1]);assert.deepEqual(added.flatMap(value=>value.added),postgresHistoryFilterMigrations.map(value=>value.id))
  assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows.slice(0,before.length),before)
  assert.equal((await owner.execute({sql:'SELECT delivery_id,created_at,numbers FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[legacy]})).rows[0].delivery_id,null)
  await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_pg_example.operator_commands TO longhorn_app');await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')
  await checkHistoryFilterIndexes(db)
  await owner.execute('DROP INDEX longhorn_queue.command_history_state')
  try{await assert.rejects(checkHistoryFilterIndexes(db),/must be deployed/)}finally{await owner.execute(postgresHistoryFilterMigrations[0].statements[1])}
  console.log('Filter upgrade: exact prior profile/checksums and retained rows, native pre-commit SIGKILL rollback, two-owner deployment and index readiness verified.')
  let url
  const start=async()=>{app=createPostgresApp({openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{}});url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url}
  await start()
  const request=(path,{cookie,body}={})=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)})
  const login=async username=>{const response=await request('/account/login',{body:{username,password}});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];secrets.push(cookie.split('=')[1]);return cookie}
  const aliceCookie=await login('filters.alice'),bobCookie=await login('filters.bobby');let operatorCookie=await login('filters.operator')
  const page=async(cookie,query='')=>{const response=await request('/account/commands'+query,{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
  const create=async(cookie,key)=>{const response=await request('/account/commands',{cookie,body:{id:key,numbers:[1,2]}});assert.equal(response.status,201);return response.json()}
  assert.equal((await request('/account/commands?state=bad')).status,401)
  for(const query of['?state=bad','?state=failed&state=pending','?state=all&owner='+bob.id,'?state=FAILED','?state=failed&queue=another'])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,400)
  for(const query of['?state=failed&scope=all','?state=bad&scope=mine&scope=all'])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,403)
  const first=await create(aliceCookie,'filters-first'),second=await create(aliceCookie,'filters-second'),third=await create(aliceCookie,'filters-third'),peer=await create(bobCookie,'filters-peer')
  outgoing=new Outbox({name:operationTopic,schema:operationData,store:new PostgresOutboxStore(db),leaseMs:60000,retryDelayMs:0})
  let entered=false,publicationSettled=false,publicationError;const publication=new Promise(resolve=>{releasePublication=resolve})
  publishing=outgoing.dispatchOnce({async publish(){entered=true;await publication}})
  publishing.then(()=>{publicationSettled=true},error=>{publicationSettled=true;publicationError=error})
  await waitFor(()=>{if(publicationError)throw publicationError;if(publicationSettled&&!entered)throw new Error('Fixture publication was not admitted');return entered})
  assert.deepEqual((await page(aliceCookie,'?state=running')).commands.map(value=>value.id),[first.command.id])
  assert.equal((await page(aliceCookie,'?state=pending')).commands.length,2)
  releasePublication();await publishing;publishing=undefined
  assert.deepEqual((await page(aliceCookie,'?state=succeeded')).commands.map(value=>value.id),[first.command.id])
  await outgoing.dispatchOnce({async publish(){throw new Error('Owned fixture delivery failure')}})
  // The actual queue retries until its configured allowance is exhausted.
  for(let count=0;count<20;count++)await outgoing.dispatchOnce({async publish(){throw new Error('Owned fixture delivery failure')}})
  assert.ok((await page(aliceCookie,'?state=failed')).commands.some(value=>value.id===second.command.id))
  assert.ok((await page(bobCookie,'?state=failed')).commands.every(value=>value.id===peer.command.id))
  // Preserve a recorded ID whose only remaining metadata belongs to a different queue.
  await owner.execute({sql:`INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at) SELECT 'outbox.unrelated',id,payload,'succeeded',1,max_attempts,available_at,created_at,updated_at FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2`,args:[queue,third.delivery.id]})
  await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2',args:[queue,third.delivery.id]})
  const unavailable=await page(aliceCookie,'?state=unavailable');assert.deepEqual(new Set(unavailable.commands.map(value=>value.id)),new Set([legacy,third.command.id]));assert.equal(unavailable.commands.find(value=>value.id===third.command.id).deliveryId,third.delivery.id);assert.ok(unavailable.commands.every(value=>value.delivery===null))
  const oldPage=await page(aliceCookie,'?limit=1');assert.equal(decode(oldPage.nextCursor).v,1);assert.equal((await page(aliceCookie,'?state=all&limit=1')).nextCursor,oldPage.nextCursor)
  const filtered=await page(aliceCookie,'?state=unavailable&limit=1');assert.equal(decode(filtered.nextCursor).v,2);assert.equal(decode(filtered.nextCursor).state,'unavailable')
  for(const query of['?state=failed&after='+filtered.nextCursor,'?after='+filtered.nextCursor,'?state=unavailable&after='+oldPage.nextCursor])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,400)
  assert.equal((await request('/account/commands?state=unavailable&after='+filtered.nextCursor,{cookie:bobCookie})).status,400)
  await app.close();app=undefined;await start()
  const older=await page(aliceCookie,'?state=unavailable&limit=2&after='+filtered.nextCursor);assert.deepEqual(older.commands.map(value=>value.id),[legacy])
  await owner.execute("SELECT pg_catalog.setval('longhorn_pg_example.operator_commands_history_seq',9007199254740993,true)")
  const preciseOne=await create(aliceCookie,'filters-precise-one'),preciseTwo=await create(aliceCookie,'filters-precise-two'),precise=await page(aliceCookie,'?state=pending&limit=1')
  assert.equal(precise.commands[0].id,preciseTwo.command.id);assert.equal(decode(precise.nextCursor).v,2);assert.equal(decode(precise.nextCursor).before,'9007199254740995');assert.equal((await page(aliceCookie,'?state=pending&limit=1&after='+precise.nextCursor)).commands[0].id,preciseOne.command.id)
  const global=await page(operatorCookie,'?scope=all&state=failed');assert.ok(global.commands.some(value=>value.id===peer.command.id))
  await store.setUserRole('filters.operator','numbers-operator',false);assert.equal((await request('/account/commands?scope=all&state=failed',{cookie:operatorCookie})).status,401);operatorCookie=await login('filters.operator');assert.equal((await request('/account/commands?scope=all&state=failed',{cookie:operatorCookie})).status,403)
  console.log('Filtered HTTP: all live states, missing/cross-queue metadata, owner/operator scope, strict claims, filter-bound v2 and compatible v1 cursors, saved-cursor restart and role revocation verified.')
  const admin=await connect({connectionString:sandbox.connectionString}),readerPassword=randomBytes(24).toString('hex');secrets.push(readerPassword)
  await admin.execute("CREATE ROLE longhorn_filter_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+readerPassword+"'");await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_filter_reader')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_pg_example,longhorn_queue TO longhorn_filter_reader');await owner.execute('GRANT SELECT(id,history_id,owner_id,created_at,delivery_id) ON longhorn_pg_example.operator_commands TO longhorn_filter_reader');await owner.execute('GRANT SELECT(queue,id,state,attempts,max_attempts,available_at,updated_at,last_failure) ON longhorn_queue.jobs TO longhorn_filter_reader')
  const readerUrl=new URL(sandbox.appUrl);readerUrl.username='longhorn_filter_reader';readerUrl.password=readerPassword
  const projection=await connect({connectionString:readerUrl.href}),reader=new PostgresCommandHistory(projection)
  for(const state of['all','pending','running','succeeded','failed','unavailable'])await reader.list(alice.id,{scope:'mine',state,limit:10})
  for(const sql of['SELECT numbers FROM longhorn_pg_example.operator_commands','SELECT payload FROM longhorn_queue.jobs','SELECT lease_token FROM longhorn_queue.jobs'])await assert.rejects(projection.execute(sql),error=>error.code==='42501')
  // Scale fixtures use real native rows and the same queue/association invariants.
  await owner.execute({sql:`WITH seed AS MATERIALIZED(SELECT pg_catalog.gen_random_uuid()::text AS command_id,pg_catalog.gen_random_uuid()::text AS delivery_id FROM pg_catalog.generate_series(1,3000)),jobs AS(INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at) SELECT $1,delivery_id,pg_catalog.jsonb_build_object('commandId',command_id,'numbers',pg_catalog.jsonb_build_array(1))::text,'succeeded',1,3,1,1,1 FROM seed) INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers,delivery_id,created_at) SELECT command_id,$2,'[1]'::jsonb,delivery_id,1 FROM seed`,args:[queue,alice.id]})
  await owner.execute('ANALYZE longhorn_pg_example.operator_commands');await owner.execute('ANALYZE longhorn_queue.jobs')
  let selectedQuery
  const observed=new PostgresCommandHistory({execute:async input=>{selectedQuery=input;return projection.execute(input)}})
  await observed.list(alice.id,{scope:'mine',state:'failed',limit:2})
  const plan=(await owner.execute({sql:'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+selectedQuery.sql,args:selectedQuery.args})).rows[0]['QUERY PLAN']
  const planText=typeof plan==='string'?plan:JSON.stringify(plan)
  assert.match(planText,/command_history_state/);assert.match(planText,/operator_commands_delivery_owner_history/)
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/history-filters-plan.json',planText)
  console.log('Filtered projection: metadata-only grants, denied secrets and actual rare-state EXPLAIN on 3000 rows uses both new indexes.')
}finally{
  releasePublication?.();await publishing?.catch(()=>{})
  for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null)child.child.kill('SIGKILL')
  await Promise.allSettled(children.map(child=>child.ended))
  try{await app?.close()}finally{try{await outgoing?.close()}finally{await Promise.allSettled(handles.map(db=>db.close()));await sandbox?.stop()}}
}
