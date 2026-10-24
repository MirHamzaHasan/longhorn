import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { postgresOperationsBaseMigrations,postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { PostgresCommandHistory } from '../examples/postgres/dist/command-history.js'
import { AuthService } from '../packages/auth/dist/index.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'

const children=[],databases=[],secrets=[],password='owned command history password',origin='http://127.0.0.1:3013',queue='outbox.command.numbers.v1'
const schema={'~standard':{version:1,vendor:'history-native',validate:value=>({value})}}
let sandbox,app,outgoing
const waitFor=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Command history condition did not settle')}
const connect=async options=>{const db=await openPostgres(options);databases.push(db);return db}
function launch(hold=false){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/command-history-migration.mjs',import.meta.url))],{env:{...process.env,HISTORY_OWNER_URL:sandbox.ownerUrl,HISTORY_HOLD_COMMIT:String(hold)},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}});child.stderr.on('data',chunk=>{output+=chunk})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance
}
const stage=(instance,name)=>waitFor(()=>{const found=instance.records.find(value=>value.stage===name);if(found)return found;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error('History migration child exited before '+name);return false})
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
const encode=value=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const decode=value=>JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')))
try{
  sandbox=await startPostgresSandbox();secrets.push(sandbox.ownerUrl,sandbox.appUrl,password)
  const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl})
  await migratePostgres(owner,postgresOperationsBaseMigrations,{schema:'longhorn_pg_example'})
  const beforeHistory=(await owner.execute('SELECT id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows
  const accounts=new AuthService(new PostgresAuthStore(owner),createScryptPasswordHasher()),store=new PostgresAuthStore(owner)
  const alice=await accounts.register('alice',password),bob=await accounts.register('bobby',password),operator=await accounts.register('operator',password)
  await store.setUserRole('operator','numbers-operator',true)
  outgoing=new Outbox({name:'command.numbers.v1',schema,store:new PostgresOutboxStore(db),retryDelayMs:0})
  const legacy=async(ownerId,numbers=[1])=>{
    const id=crypto.randomUUID();await owner.execute({sql:'INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers) VALUES($1,$2,$3::jsonb)',args:[id,ownerId,JSON.stringify(numbers)]});return{id,numbers}
  }
  const a=await legacy(alice.id,[2,4]),b=await legacy(bob.id,[6]),pruned=await legacy(alice.id,[8]),ambiguous=await legacy(alice.id,[9])
  const aDelivery=await outgoing.enqueue({commandId:a.id,numbers:a.numbers},{maxAttempts:1}),bDelivery=await outgoing.enqueue({commandId:b.id,numbers:b.numbers},{maxAttempts:1})
  await outgoing.enqueue({commandId:ambiguous.id,numbers:ambiguous.numbers},{maxAttempts:1});await outgoing.enqueue({commandId:ambiguous.id,numbers:ambiguous.numbers},{maxAttempts:1})
  const removed=await outgoing.enqueue({commandId:pruned.id,numbers:pruned.numbers},{maxAttempts:1});await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2',args:[queue,removed.id]})
  await outgoing.enqueue({commandId:a.id,numbers:[999]},{maxAttempts:1}) // same command ID, wrong input is not a match
  for(const payload of ['not-json','{"bad":"\\u0000"}','{"bad":1e1000000}'])await owner.execute({sql:"INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at) VALUES($1,$2,$3,'failed',1,1,1,1,1)",args:[queue,crypto.randomUUID(),payload]})
  const held=launch(true);await stage(held,'before-commit')
  const visibleColumn=async()=>Number((await owner.execute("SELECT count(*) AS count FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='longhorn_pg_example' AND c.relname='operator_commands' AND a.attname='history_id' AND NOT a.attisdropped")).rows[0].count)
  assert.equal(await visibleColumn(),0);assert.equal((await end(held,'SIGKILL')).signal,'SIGKILL');assert.equal(await visibleColumn(),0)
  const migrations=[launch(),launch()];const added=[]
  for(const instance of migrations){const result=await stage(instance,'migrated');added.push(result.added);assert.equal((await end(instance)).code,0)}
  assert.deepEqual(added.map(value=>value.length).sort(),[0,postgresOperationsMigrations.length-postgresOperationsBaseMigrations.length]);assert.deepEqual(added.flat(),postgresOperationsMigrations.slice(postgresOperationsBaseMigrations.length).map(migration=>migration.id))
  const afterHistory=(await owner.execute('SELECT id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows;assert.deepEqual(afterHistory.slice(0,beforeHistory.length),beforeHistory)
  const legacyRows=(await owner.execute('SELECT id,delivery_id,created_at,history_id FROM longhorn_pg_example.operator_commands ORDER BY history_id')).rows
  assert.equal(legacyRows.find(value=>value.id===a.id).delivery_id,aDelivery.id);assert.equal(Number(legacyRows.find(value=>value.id===a.id).created_at),aDelivery.createdAt)
  assert.equal(legacyRows.find(value=>value.id===b.id).delivery_id,bDelivery.id)
  for(const id of [pruned.id,ambiguous.id]){const row=legacyRows.find(value=>value.id===id);assert.equal(row.delivery_id,null);assert.equal(row.created_at,null)}
  assert.equal(legacyRows.length,4);assert.equal(new Set(legacyRows.map(value=>String(value.history_id))).size,4)
  await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app')
  await owner.execute('GRANT SELECT,INSERT ON longhorn_pg_example.operator_commands TO longhorn_app');await owner.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON longhorn_pg_example.history_views TO longhorn_app')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_outbox TO longhorn_app');await owner.execute('GRANT SELECT,INSERT ON longhorn_outbox.recovery_audit TO longhorn_app')
  console.log('History upgrade: immutable legacy migration prefix, real DDL/metadata SIGKILL rollback, concurrent owner migrations, safe malformed/overflow JSON handling and unambiguous retained-delivery backfill verified.')

  let url
  const start=async()=>{
    app=createPostgresApp({openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),workerEnabled:false,schedulerEnabled:false,accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{}})
    url=(await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0})).url
  }
  await start()
  const request=(path,{cookie,body,method}={})=>fetch(url+path,{method:method??(body===undefined?'GET':'POST'),headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)})
  const login=async username=>{const response=await request('/account/login',{body:{username,password}});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];secrets.push(cookie.split('=')[1]);return cookie}
  const aliceCookie=await login('alice'),bobCookie=await login('bobby');let operatorCookie=await login('operator')
  const page=async(cookie,query='')=>{const response=await request('/account/commands'+query,{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('vary'),/Cookie/);return response.json()}
  const create=async(cookie,key,numbers=[1])=>{const response=await request('/account/commands',{cookie,body:{id:key,numbers}});assert.equal(response.status,201);return response.json()}
  assert.equal((await request('/account/commands?limit=garbage')).status,401)
  for(const query of ['?scope=all','?scope=all&after=garbage','?scope=mine&scope=all','?scope=all&scope=mine'])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,403)
  for(const query of ['?limit=101','?limit=0','?owner='+bob.id,'?queue=another','?state=invalid','?after=not-json'])assert.equal((await request('/account/commands'+query,{cookie:aliceCookie})).status,400)
  const initial=await page(aliceCookie),initialIds=new Set(initial.commands.map(value=>value.id));assert.deepEqual(initialIds,new Set([a.id,pruned.id,ambiguous.id]));assert.ok(!initialIds.has(b.id))
  assert.ok(initial.commands.every(value=>!Object.hasOwn(value,'numbers')&&!Object.hasOwn(value,'ownerId')))
  assert.equal(initial.commands.find(value=>value.id===a.id).delivery.state,'pending')
  const created=await Promise.all(Array.from({length:12},(_,index)=>create(index%2?bobCookie:aliceCookie,'history-'+index,[index,42])))
  const expectedAlice=new Set([a.id,pruned.id,ambiguous.id,...created.filter((_,index)=>index%2===0).map(value=>value.command.id)])
  const first=await page(aliceCookie,'?limit=2'),cursor=first.nextCursor;assert.ok(cursor)
  assert.equal((await request('/account/commands?after='+cursor,{cookie:bobCookie})).status,400)
  const all=await page(operatorCookie,'?scope=all&limit=2');assert.ok(all.nextCursor)
  assert.equal((await request('/account/commands?after='+all.nextCursor,{cookie:operatorCookie})).status,400)
  for(const changes of [{viewer:bob.id},{scope:'all'},{queue:'outbox.another'},{v:2},{before:'9223372036854775808'}])assert.equal((await request('/account/commands?after='+encode({...decode(cursor),...changes}),{cookie:aliceCookie})).status,400)
  const newest=await create(aliceCookie,'during-traversal',[77]);assert.ok(!expectedAlice.has(newest.command.id))
  await app.close();app=undefined;await start()
  const seen=[...first.commands];let after=cursor
  while(after){const next=await page(aliceCookie,'?limit=2&after='+after);seen.push(...next.commands);after=next.nextCursor}
  assert.equal(new Set(seen.map(value=>value.id)).size,seen.length);assert.deepEqual(new Set(seen.map(value=>value.id)),expectedAlice)
  assert.equal((await page(aliceCookie,'?limit=1')).commands[0].id,newest.command.id)
  const replay=await request('/account/commands',{cookie:aliceCookie,body:{id:'during-traversal',numbers:[77]}});assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),newest)
  assert.equal((await owner.execute({sql:'SELECT count(*) AS count FROM longhorn_pg_example.operator_commands WHERE id=$1',args:[newest.command.id]})).rows[0].count,1n)
  // Positions are insertion order, not commit order. A lower-position late commit can appear on a later page.
  let release,inserted;const heldId=crypto.randomUUID(),gate=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{inserted=resolve})
  const writer=owner.transaction(async tx=>{await tx.execute({sql:'INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers) VALUES($1,$2,$3::jsonb)',args:[heldId,bob.id,'[1]']});inserted();await gate})
  let visible
  try{await ready;const committed=await create(bobCookie,'commit-before-older');visible=await page(bobCookie,'?limit=1');assert.equal(visible.commands[0].id,committed.command.id)}finally{release();await writer}
  assert.equal((await page(bobCookie,'?limit=1&after='+visible.nextCursor)).commands[0].id,heldId)

  // Identity values remain exact beyond JS safe integers; cursor comparisons stay native bigint.
  await owner.execute("SELECT pg_catalog.setval('longhorn_pg_example.operator_commands_history_seq',9007199254740993,true)")
  const preciseOne=await create(aliceCookie,'precise-one'),preciseTwo=await create(aliceCookie,'precise-two')
  const precise=await page(aliceCookie,'?limit=1');assert.equal(precise.commands[0].id,preciseTwo.command.id);assert.equal(decode(precise.nextCursor).before,'9007199254740995')
  assert.equal((await page(aliceCookie,'?limit=1&after='+precise.nextCursor)).commands[0].id,preciseOne.command.id)
  console.log('History HTTP: owner isolation, explicit operator scope, duplicate-query/forged-cursor denial, exact int64 positions, concurrent writers, replay and cursor traversal across actual app restart verified.')

  // The readonly projection role cannot read business numbers, outgoing payloads or lease tokens.
  const admin=await connect({connectionString:sandbox.connectionString}),projectionPassword=randomBytes(24).toString('hex');secrets.push(projectionPassword)
  await admin.execute("CREATE ROLE longhorn_history_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+projectionPassword+"'")
  await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_history_reader')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_pg_example,longhorn_queue TO longhorn_history_reader')
  await owner.execute('GRANT SELECT(id,history_id,owner_id,created_at,delivery_id) ON longhorn_pg_example.operator_commands TO longhorn_history_reader')
  await owner.execute('GRANT SELECT(queue,id,state,attempts,max_attempts,available_at,updated_at,last_failure) ON longhorn_queue.jobs TO longhorn_history_reader')
  const projectionUrl=new URL(sandbox.appUrl);projectionUrl.username='longhorn_history_reader';projectionUrl.password=projectionPassword
  const projection=await connect({connectionString:projectionUrl.href}),reader=new PostgresCommandHistory(projection)
  assert.ok((await reader.list(alice.id,{scope:'mine',limit:100})).commands.length>0)
  for(const sql of ['SELECT numbers FROM longhorn_pg_example.operator_commands','SELECT payload FROM longhorn_queue.jobs','SELECT lease_token FROM longhorn_queue.jobs'])await assert.rejects(projection.execute(sql),error=>error.code==='42501')
  await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE queue=$1 AND id=$2',args:[queue,aDelivery.id]})
  const retained=(await page(aliceCookie)).commands.find(value=>value.id===a.id);assert.equal(retained.deliveryId,aDelivery.id);assert.equal(retained.delivery,null)
  assert.equal((await request('/account/commands/'+b.id,{cookie:aliceCookie})).status,404)
  await assert.rejects(db.execute("UPDATE longhorn_pg_example.operator_commands SET delivery_id='forged'"),error=>error.code==='42501')

  // Insert and outgoing staging remain one transaction if the business insert fails.
  const jobsBefore=Number((await db.execute({sql:'SELECT count(*) AS count FROM longhorn_queue.jobs WHERE queue=$1',args:[queue]})).rows[0].count)
  const repository=new PostgresCommandHistory(db)
  await assert.rejects(db.transaction(async tx=>{const delivery=await outgoing.enqueueInTransaction(tx,{commandId:a.id,numbers:[99]});await repository.insertIn(tx,{id:a.id,ownerId:alice.id,numbers:[99],deliveryId:delivery.id,createdAt:delivery.createdAt})}),error=>error.code==='23505')
  assert.equal(Number((await db.execute({sql:'SELECT count(*) AS count FROM longhorn_queue.jobs WHERE queue=$1',args:[queue]})).rows[0].count),jobsBefore)
  // Drive a real delivery and observe its live metadata through the joined history projection.
  for(let count=0;count<100;count++){const result=await outgoing.dispatchOnce({async publish(){}});if(result.status==='idle')break}
  const done=(await page(aliceCookie)).commands.find(value=>value.id===preciseTwo.command.id);assert.equal(done.delivery.state,'succeeded');assert.equal(done.delivery.attempts,1)
  assert.ok(!JSON.stringify(done).includes('leaseToken'));assert.ok(!JSON.stringify(done).includes('payload'))
  await store.setUserRole('operator','numbers-operator',false);assert.equal((await request('/account/commands?scope=all&after='+all.nextCursor,{cookie:operatorCookie})).status,401)
  operatorCookie=await login('operator');assert.equal((await request('/account/commands?scope=all&after='+all.nextCursor,{cookie:operatorCookie})).status,403)
  assert.equal((await page(operatorCookie)).commands.length,0)
  console.log('History projection: minimal column grants exclude payloads/numbers/lease tokens; pruning retains delivery identity with unavailable metadata, real dispatch updates status, failed inserts roll back staged jobs and role/session revocation blocks global pages.')
  for(const instance of children)for(const secret of secrets)assert.ok(!instance.output().includes(secret),'A private credential was logged')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  try{await app?.close()}finally{try{await outgoing?.close()}finally{await Promise.allSettled(databases.map(database=>database.close()));await sandbox?.stop()}}
}
