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
import { postgresHistorySearchMigrations,checkHistorySearchIndexes } from '../examples/postgres/dist/history-search-migrations.js'
import { PostgresCommandHistory } from '../examples/postgres/dist/command-history.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { AuthService } from '../packages/auth/dist/index.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { operationData,operationTopic } from '../examples/postgres/dist/operation-contracts.js'
const password='owned native searched history password',queue='outbox.'+operationTopic,origin='http://127.0.0.1:3013',handles=[],children=[],secrets=[password]
let sandbox,app,outgoing,releasePublication,publishing
const waitFor=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('History search condition did not settle')}
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
  sandbox=await startPostgresSandbox();const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl})
  const previous=postgresOperationsMigrations.slice(0,-postgresHistorySearchMigrations.length);assert.equal(previous.at(-1).id,'postgres_account_operations/003_history_filters')
  await migratePostgres(owner,previous,{schema:'longhorn_pg_example'})
  const store=new PostgresAuthStore(owner),accounts=new AuthService(store,createScryptPasswordHasher()),alice=await accounts.register('search.alice',password),bob=await accounts.register('search.bobby',password)
  await accounts.register('search.operator',password);await store.setUserRole('search.operator','numbers-operator',true)
  const legacy=crypto.randomUUID();await owner.execute({sql:"INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers) VALUES($1,$2,'[1]'::jsonb)",args:[legacy,alice.id]})
  const before=(await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows,held=migration(true);await stage(held,'before-commit')
  assert.equal((await owner.execute("SELECT pg_catalog.to_regclass('longhorn_pg_example.operator_commands_search_history')::text AS name")).rows[0].name,null)
  assert.equal((await finish(held,'SIGKILL')).signal,'SIGKILL');assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows,before)
  const one=migration(),two=migration(),added=await Promise.all([stage(one,'migrated'),stage(two,'migrated')]);for(const child of[one,two])assert.deepEqual(await finish(child),{code:0,signal:null})
  assert.deepEqual(added.map(v=>v.added.length).sort(),[0,1]);assert.deepEqual(added.flatMap(v=>v.added),postgresHistorySearchMigrations.map(v=>v.id));assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows.slice(0,before.length),before)
  assert.equal((await owner.execute({sql:'SELECT id FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[legacy]})).rows[0].id,legacy)
  await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_pg_example.operator_commands TO longhorn_app');await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')
  await checkHistorySearchIndexes(db);await owner.execute('DROP INDEX longhorn_pg_example.operator_commands_owner_search_history');try{await assert.rejects(checkHistorySearchIndexes(db),/must be deployed/)}finally{await owner.execute(postgresHistorySearchMigrations[0].statements[1])}
  console.log('Search upgrade: exact prior profile/checksums and retained rows, pre-commit SIGKILL rollback, two-owner serialization and index readiness verified.')
  let url
  const start=async()=>{app=createPostgresApp({openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{}});url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url};await start()
  const request=(path,{cookie,body}={})=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)})
  const login=async username=>{const response=await request('/account/login',{body:{username,password}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0]}
  const aliceCookie=await login('search.alice'),bobCookie=await login('search.bobby');let operatorCookie=await login('search.operator')
  const page=async(cookie,query='')=>{const response=await request('/account/commands'+query,{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
  const create=async(cookie,key)=>{const response=await request('/account/commands',{cookie,body:{id:key,numbers:[1,2]}});assert.equal(response.status,201);return response.json()}
  assert.equal((await request('/account/commands?q=bad')).status,401)
  for(const query of['?q=abc','?q=abcd%25','?q=abcd_','?q=abcd&q=abce','?q=abcd&owner='+bob.id,'?q=abcd&queue=another','?q=abcd12345'])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,400)
  assert.equal((await request('/account/commands?scope=all&q=abcd',{cookie:aliceCookie})).status,403)
  const first=await create(aliceCookie,'search-first'),second=await create(aliceCookie,'search-second'),peer=await create(bobCookie,'search-peer'),firstQuery='?q='+first.command.id.slice(0,8)
  assert.deepEqual((await page(aliceCookie,'?q='+encodeURIComponent('  '+first.command.id.toUpperCase()+'  '))).commands.map(c=>c.id),[first.command.id]);assert.equal((await page(aliceCookie,'?q='+peer.command.id)).commands.length,0)
  outgoing=new Outbox({name:operationTopic,schema:operationData,store:new PostgresOutboxStore(db),leaseMs:60000,retryDelayMs:0})
  let entered=false,settled=false,publicationError;const publication=new Promise(done=>{releasePublication=done});publishing=outgoing.dispatchOnce({async publish(){entered=true;await publication}});publishing.then(()=>{settled=true},error=>{settled=true;publicationError=error})
  await waitFor(()=>{if(publicationError)throw publicationError;if(settled&&!entered)throw new Error('Owned publication was not admitted');return entered})
  assert.deepEqual((await page(aliceCookie,firstQuery+'&state=running')).commands.map(c=>c.id),[first.command.id]);assert.deepEqual((await page(aliceCookie,'?q='+second.command.id+'&state=pending')).commands.map(c=>c.id),[second.command.id])
  releasePublication();await publishing;publishing=undefined;assert.equal((await page(aliceCookie,firstQuery+'&state=succeeded')).commands.length,1)
  for(let i=0;i<10;i++)await outgoing.dispatchOnce({async publish(){throw new Error('Owned search publisher failure')}})
  assert.equal((await page(aliceCookie,'?q='+second.command.id+'&state=failed')).commands.length,1)
  await owner.execute({sql:"INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at) SELECT 'outbox.unrelated',id,payload,state,attempts,max_attempts,available_at,created_at,updated_at FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2",args:[queue,first.delivery.id]});await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2',args:[queue,first.delivery.id]})
  const missing=await page(aliceCookie,firstQuery+'&state=unavailable');assert.equal(missing.commands[0].deliveryId,first.delivery.id);assert.equal(missing.commands[0].delivery,null)
  const v1=await page(aliceCookie,'?limit=1'),v2=await page(aliceCookie,'?state=unavailable&limit=1');assert.equal(decode(v1.nextCursor).v,1);assert.equal(decode(v2.nextCursor).v,2);assert.equal((await page(aliceCookie,'?q=%20%20&limit=1')).nextCursor,v1.nextCursor)
  for(const after of[v1.nextCursor,v2.nextCursor])assert.equal((await request('/account/commands?q=abcd&after='+after,{cookie:aliceCookie})).status,400)
  await owner.execute("SELECT pg_catalog.setval('longhorn_pg_example.operator_commands_history_seq',9007199254740993,true)")
  await owner.execute({sql:`WITH seed AS MATERIALIZED(SELECT g,CASE WHEN g<=3 THEN 'deadbeef-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,10) WHEN g<=6 THEN CASE WHEN g=4 THEN pg_catalog.upper('feedface-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,10)) ELSE 'feedface-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,10) END WHEN g BETWEEN 3001 AND 3030 THEN 'feedface-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,10) ELSE '12345678-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,10) END AS command_id,pg_catalog.gen_random_uuid()::text AS delivery_id FROM pg_catalog.generate_series(1,6000) g),jobs AS(INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at) SELECT $1,delivery_id,pg_catalog.jsonb_build_object('commandId',command_id,'numbers',pg_catalog.jsonb_build_array(1))::text,'succeeded',1,3,1,1,1 FROM seed) INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers,delivery_id,created_at) SELECT command_id,CASE WHEN g<=3000 THEN $2 ELSE $3 END,'[1]'::jsonb,delivery_id,1 FROM seed`,args:[queue,alice.id,bob.id]})
  const searched=await page(aliceCookie,'?q=feedface&limit=1');assert.equal(decode(searched.nextCursor).v,3);assert.equal(decode(searched.nextCursor).q,'feedface');assert.ok(BigInt(decode(searched.nextCursor).before)>BigInt(Number.MAX_SAFE_INTEGER))
  for(const query of['?q=deadbeef&after=','?q=feedface&state=succeeded&after=','?after=','?q=%20&after='])assert.equal((await request('/account/commands'+query+searched.nextCursor,{cookie:aliceCookie})).status,400)
  assert.equal((await request('/account/commands?q=feedface&after='+searched.nextCursor,{cookie:bobCookie})).status,400)
  await app.close();app=undefined;await start();const older=await page(aliceCookie,'?q=FEEDFACE&limit=2&after='+searched.nextCursor);assert.equal(older.commands.length,2);assert.ok(older.commands.every(c=>c.id.toLowerCase().startsWith('feedface')));assert.equal(older.nextCursor,null)
  const mine=await page(aliceCookie,'?q=feedface'),global=await page(operatorCookie,'?q=feedface&scope=all');assert.equal(mine.commands.length,3);assert.ok(mine.commands.some(c=>c.id.startsWith('FEEDFACE')));assert.equal(global.commands.length,20);assert.ok(global.nextCursor)
  await store.setUserRole('search.operator','numbers-operator',false);assert.equal((await request('/account/commands?q=feedface&scope=all',{cookie:operatorCookie})).status,401);operatorCookie=await login('search.operator');assert.equal((await request('/account/commands?q=feedface&scope=all',{cookie:operatorCookie})).status,403)
  console.log('Search HTTP: real queue states, unavailable/cross-queue metadata, normalized owner/operator search, strict claims, v1/v2 compatibility, v3 context/int64/restart and role revocation verified.')
  const admin=await connect({connectionString:sandbox.connectionString}),readerPassword=randomBytes(24).toString('hex');await admin.execute("CREATE ROLE longhorn_search_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+readerPassword+"'");await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_search_reader')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_pg_example,longhorn_queue TO longhorn_search_reader');await owner.execute('GRANT SELECT(id,history_id,owner_id,created_at,delivery_id) ON longhorn_pg_example.operator_commands TO longhorn_search_reader');await owner.execute('GRANT SELECT(queue,id,state,attempts,max_attempts,available_at,updated_at,last_failure) ON longhorn_queue.jobs TO longhorn_search_reader')
  const readerUrl=new URL(sandbox.appUrl);readerUrl.username='longhorn_search_reader';readerUrl.password=readerPassword;const projection=await connect({connectionString:readerUrl.href}),reader=new PostgresCommandHistory(projection)
  for(const state of['all','pending','running','succeeded','failed','unavailable'])await reader.list(alice.id,{scope:'mine',state,q:'feedface',limit:10})
  for(const sql of['SELECT numbers FROM longhorn_pg_example.operator_commands','SELECT payload FROM longhorn_queue.jobs','SELECT lease_token FROM longhorn_queue.jobs'])await assert.rejects(projection.execute(sql),error=>error.code==='42501')
  await owner.execute('ANALYZE longhorn_pg_example.operator_commands');await owner.execute('ANALYZE longhorn_queue.jobs');const plans={}
  for(const [scope,q,index]of[['mine','feedface','operator_commands_owner_search_history'],['all','deadbeef','operator_commands_search_history']]){
    let statement;const observed=new PostgresCommandHistory({execute:async input=>{statement=input;return projection.execute(input)}});await observed.list(alice.id,{scope,q,limit:100})
    const result=(await owner.execute({sql:'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.sql,args:statement.args})).rows[0]['QUERY PLAN'];plans[scope]=typeof result==='string'?JSON.parse(result):result;assert.match(JSON.stringify(plans[scope]),new RegExp(index))
  }
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/history-search-plans.json',JSON.stringify(plans,null,2));console.log('Search projection: metadata-only grants and denied secrets; actual owner/global prefix plans on 6000 native rows use both new indexes without forced planner settings.')
}finally{
  releasePublication?.();await publishing?.catch(()=>{});for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null)child.child.kill('SIGKILL');await Promise.allSettled(children.map(child=>child.ended))
  try{await app?.close()}finally{try{await outgoing?.close()}finally{await Promise.allSettled(handles.map(db=>db.close()));await sandbox?.stop()}}
}
