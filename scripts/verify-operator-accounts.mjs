import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { mkdtemp,rm,readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createQueuePublisher } from '../runtimes/workers/dist/outbox.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { AuthService } from '../packages/auth/dist/index.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'

const children=[],databases=[],secrets=[],origin='http://127.0.0.1:3010',password='owned native account password',schema={'~standard':{version:1,vendor:'operator-native',validate:value=>({value})}}
let sandbox,app,broker,objectWorker,temporary
const waitFor=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Operator condition did not settle')}
function launch(script,env={},args=[]){
  const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.stderr.on('data',chunk=>{output+=chunk});child.on('error',error=>{output+=String(error)})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance
}
const stage=(instance,name)=>waitFor(()=>{const value=instance.records.find(record=>record.stage===name||record.message===name);if(value)return value;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error('Operator child exited before '+name);return false})
const go=instance=>instance.child.stdin.write('go\n')
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{return await instance.ended}finally{clearTimeout(timer)}}
const connect=async(options)=>{const database=await openPostgres(options);databases.push(database);return database}
try{
  const archive=async path=>readFile(new URL('../cli/dist/framework/'+path,import.meta.url),'utf8')
  assert.match(await archive('auth/dist/index.d.ts'),/TransactionalAuthStore/)
  assert.match(await archive('auth/dist/postgres.d.ts'),/postgresAuthTransactionMigrations/)
  assert.match(await archive('outbox/dist/index.d.ts'),/retryFailedAuthorized/)
  assert.match(await archive('outbox/dist/hono.d.ts'),/createOutboxOperations/)
  const packed=JSON.parse(await archive('outbox/package.json'))
  assert.ok(packed.exports['./hono']);assert.ok(packed.dependencies['@longhorn/validation']);assert.ok(packed.dependencies.hono)
  sandbox=await startAccountOperationsSandbox()
  const db=await connect({connectionString:sandbox.appUrl}),owner=await connect({connectionString:sandbox.ownerUrl}),admin=await connect({connectionString:sandbox.connectionString})
  const store=new PostgresAuthStore(owner),accounts=new AuthService(new PostgresAuthStore(db),createScryptPasswordHasher())
  const fn=(await owner.execute(`SELECT p.prosecdef,p.provolatile,p.proconfig::text,r.rolsuper,p.prosrc FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='longhorn_auth.lock_session_user(text)'::regprocedure`)).rows[0]
  assert.equal(fn.prosecdef,true);assert.equal(fn.provolatile,'v');assert.equal(fn.rolsuper,false);assert.match(fn.proconfig,/pg_catalog, pg_temp/);assert.ok(!fn.prosrc.includes('password_hash'))
  assert.equal((await owner.execute("SELECT has_function_privilege('public','longhorn_auth.lock_session_user(text)','EXECUTE') AS allowed")).rows[0].allowed,false)
  await assert.rejects(db.execute("UPDATE longhorn_auth.users SET roles='[]'::jsonb"),error=>error.code==='42501')
  await assert.rejects(db.execute("UPDATE longhorn_outbox.recovery_audit SET actor='forged'"),error=>error.code==='42501')
  await owner.execute('REVOKE EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) FROM longhorn_app')
  const ungranted=createPostgresApp({openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{}})
  try{await assert.rejects(ungranted.start())}finally{await ungranted.close();await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app')}
  // Normal migration command must not silently truncate this opt-in deployment profile.
  const migrated=launch('../examples/postgres/dist/migrate-operations.js',{MIGRATION_DATABASE_URL:sandbox.ownerUrl})
  assert.equal((await end(migrated)).code,0)
  broker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/index.js',import.meta.url)),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),
    queueProducers:{MESSAGES:'operator-native'},queueConsumers:{'operator-native':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:2}},durableObjects:{COMMANDS:{className:'CommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}}})
  await broker.ready
  const publisher=createQueuePublisher(await broker.getQueueProducer('MESSAGES'));let available=false,duplicate=false
  app=createPostgresApp({openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},operations:{
    publisher:{async publish(message,context){if(!available)throw new Error('Owned publisher unavailable');await publisher.publish(message,context);if(duplicate)await publisher.publish(message,context)}},
    readReceipt:id=>broker.dispatchFetch('http://receipts/receipts/'+id)}})
  const server=await app.listen(nodeRuntime,{hostname:'127.0.0.1',port:0}),url=server.url
  const request=async(path,{cookie,body,method,headers={}}={})=>fetch(url+path,{method:method??(body===undefined?'GET':'POST'),headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)})
  const login=async(username,cookie)=>{const response=await request('/account/login',{cookie,body:{username,password}});assert.equal(response.status,200);const issued=response.headers.get('set-cookie').split(';')[0];secrets.push(issued.split('=')[1]);return issued}
  const register=async username=>{const response=await request('/account/register',{body:{username,password}});assert.equal(response.status,201);const value=await response.json();assert.deepEqual(value.user.roles,['member']);return value.user}
  const alice=await register('alice'),bob=await register('bobby');let aliceCookie=await login('alice');const bobCookie=await login('bobby')
  assert.equal((await request('/account/operations/deliveries')).status,401)
  assert.equal((await request('/account/operations/deliveries/not-a-uuid/retry',{cookie:aliceCookie,body:{actor:'forged'}})).status,403)
  assert.equal((await request('/account/register',{body:{username:'forged',password,roles:['numbers-operator']}})).status,400)
  const provisioning=launch('../examples/postgres/dist/operator-role.js',{MIGRATION_DATABASE_URL:sandbox.ownerUrl},['grant','alice'])
  assert.equal((await end(provisioning)).code,0);assert.equal((await request('/account/operations/deliveries',{cookie:aliceCookie})).status,401)
  aliceCookie=await login('alice')
  assert.equal((await store.setUserRole('alice','numbers-operator',true)).status,'unchanged')
  const inspected=await request('/account/operations/deliveries',{cookie:aliceCookie});assert.equal(inspected.status,200);assert.equal(inspected.headers.get('cache-control'),'no-store');assert.match(inspected.headers.get('vary'),/Cookie/)
  const commandInput={id:'one-account-key',numbers:[2,4,8]},created=await request('/account/commands',{cookie:bobCookie,body:commandInput});assert.equal(created.status,201)
  const command=await created.json(),replay=await request('/account/commands',{cookie:bobCookie,body:commandInput});assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),command)
  assert.equal((await request('/account/commands',{cookie:bobCookie,body:{...commandInput,numbers:[9]}})).status,409)
  const other=await request('/account/commands',{cookie:aliceCookie,body:commandInput});assert.equal(other.status,201);assert.notEqual((await other.json()).command.id,command.command.id)
  const charlie=await register('charlie'),charlieCookie=await login('charlie')
  for(const suffix of ['', '/receipt'])assert.equal((await request('/account/commands/'+command.command.id+suffix,{cookie:charlieCookie})).status,404)
  assert.equal((await request('/account/commands/'+command.command.id,{cookie:aliceCookie})).status,200)
  const deliveryPath='/account/operations/deliveries/'+command.delivery.id
  const failed=await waitFor(async()=>{const response=await request(deliveryPath,{cookie:aliceCookie});const value=await response.json();return value.delivery?.state==='failed'?value.delivery:false})
  const retryPath=deliveryPath+'/retry',retryBody={expectedMaxAttempts:failed.maxAttempts,additionalAttempts:1,reason:'provider-restored'}
  assert.equal((await request(retryPath,{cookie:aliceCookie,body:{...retryBody,actor:'user:'+bob.id}})).status,400)
  assert.equal((await request(retryPath,{cookie:aliceCookie,body:retryBody,headers:{Origin:'https://untrusted.example'}})).status,403)
  assert.equal((await request(retryPath,{cookie:aliceCookie,body:retryBody,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403)
  assert.equal((await request(deliveryPath,{cookie:aliceCookie+'; '+aliceCookie})).status,401)
  assert.equal((await(await request('/account/operations/audit',{cookie:aliceCookie})).json()).records.length,0)
  available=true;duplicate=true
  const recoveries=await Promise.all([request(retryPath,{cookie:aliceCookie,body:retryBody}),request(retryPath,{cookie:aliceCookie,body:retryBody})]);assert.deepEqual(recoveries.map(value=>value.status).sort(),[202,409])
  const receipts=await waitFor(async()=>{const response=await request('/account/commands/'+command.command.id+'/receipt',{cookie:bobCookie});return response.ok?response.json():false})
  assert.equal(receipts.receipts.length,1);assert.equal(receipts.receipts[0].messageId,command.delivery.id);assert.equal(receipts.receipts[0].result.sum,14)
  const audit=await(await request('/account/operations/audit?deliveryId='+command.delivery.id,{cookie:aliceCookie})).json();assert.equal(audit.records.length,2);assert.ok(audit.records.every(value=>value.actor==='user:'+alice.id));assert.deepEqual(audit.records.map(value=>value.outcome).sort(),['conflict','scheduled'])
  assert.ok(audit.records.every(value=>!Object.hasOwn(value,'payload')&&!Object.hasOwn(value,'tokenHash')))
  const page=await(await request('/account/operations/audit?limit=1',{cookie:aliceCookie})).json();assert.ok(page.nextCursor)
  assert.equal((await request('/account/operations/audit?deliveryId='+command.delivery.id+'&after='+page.nextCursor,{cookie:aliceCookie})).status,400)
  let previous=aliceCookie;aliceCookie=await login('alice',previous);assert.equal((await request(deliveryPath,{cookie:previous})).status,401)
  assert.equal((await request('/account/logout',{cookie:aliceCookie,body:{}})).status,204);assert.equal((await request(deliveryPath,{cookie:aliceCookie})).status,401)
  aliceCookie=await login('alice');const second=await login('alice');assert.equal((await request('/account/logout-all',{cookie:aliceCookie,body:{}})).status,204);assert.equal((await request(deliveryPath,{cookie:second})).status,401)
  aliceCookie=await login('alice');await store.setUserRole('alice','numbers-operator',false);assert.equal((await request(deliveryPath,{cookie:aliceCookie})).status,401);aliceCookie=await login('alice');assert.equal((await request(deliveryPath,{cookie:aliceCookie})).status,403)
  // A provisioning-only connection neither needs password hashes nor broad user updates.
  const provisioningPassword=randomBytes(24).toString('hex');secrets.push(provisioningPassword)
  await admin.execute("CREATE ROLE longhorn_operator_provisioner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+provisioningPassword+"'")
  await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_operator_provisioner')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_auth TO longhorn_operator_provisioner')
  await owner.execute('GRANT SELECT(id,username,roles),UPDATE(roles) ON longhorn_auth.users TO longhorn_operator_provisioner')
  await owner.execute('GRANT SELECT(user_id),DELETE ON longhorn_auth.sessions TO longhorn_operator_provisioner')
  const provisionUrl=new URL(sandbox.appUrl);provisionUrl.username='longhorn_operator_provisioner';provisionUrl.password=provisioningPassword
  const minimal=await connect({connectionString:provisionUrl.href}),provisioner=new PostgresAuthStore(minimal)
  await assert.rejects(minimal.execute('SELECT password_hash FROM longhorn_auth.users'),error=>error.code==='42501')
  assert.equal((await provisioner.setUserRole('charlie','numbers-operator',true)).revokedSessions,1)
  const retained=await accounts.sessions.create(charlie.id);secrets.push(retained.token)
  await owner.execute('REVOKE DELETE ON longhorn_auth.sessions FROM longhorn_operator_provisioner')
  try{await assert.rejects(provisioner.setUserRole('charlie','numbers-operator',false),error=>error.code==='42501')}finally{await owner.execute('GRANT DELETE ON longhorn_auth.sessions TO longhorn_operator_provisioner')}
  assert.ok((await accounts.authenticate(retained.token)).user.roles.includes('numbers-operator'))
  assert.equal((await provisioner.setUserRole('charlie','numbers-operator',false)).revokedSessions,1)
  console.log('Account HTTP: real scrypt/cookies, trusted CLI grant, member/origin/spoof denial, owner-scoped idempotent commands, operator retry race, stable-ID broker dedupe, user attribution and session/role revocation verified.')

  // Dedicated test queue has no dispatcher, so native transaction outcomes remain inspectable.
  const queue='operator-locks.v1',outgoing=new Outbox({name:queue,schema,store:new PostgresOutboxStore(db)})
  const seed=async()=>{await store.setUserRole('alice','numbers-operator',true);const session=await accounts.sessions.create(alice.id);secrets.push(session.token);const delivery=await outgoing.enqueue({value:1},{maxAttempts:1});await outgoing.dispatchOnce({async publish(){throw new Error('Owned failure')}});return{session,delivery}}
  const processFor=(mode,seed,ownerRole=false)=>{
    const tag='operator-'+crypto.randomUUID()
    return Object.assign(launch('./fixtures/operator-account-process.mjs',{LONGHORN_OPERATOR_URL:ownerRole?sandbox.ownerUrl:sandbox.appUrl,LONGHORN_OPERATOR_MODE:mode,LONGHORN_OPERATOR_TAG:tag,LONGHORN_OPERATOR_TOKEN:seed.session.token,LONGHORN_OPERATOR_DELIVERY:seed.delivery.id,LONGHORN_OPERATOR_QUEUE:queue,LONGHORN_OPERATOR_USER:alice.id,LONGHORN_OPERATOR_USERNAME:'alice'}),{tag})
  }
  // Use application_name to find a backend belonging to this owned child; OS pid differs from backend pid.
  const blockedChild=instance=>waitFor(async()=>{const rows=(await admin.execute({sql:"SELECT wait_event_type FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",args:[instance.tag]})).rows;return rows.length>0})
  try{
    for(const mode of ['raw-revoke','raw-role','provision']){
      const item=await seed(),holder=processFor('hold',item);await stage(holder,'ready');go(holder);await stage(holder,'authorized')
      const writer=processFor(mode,item,true);await stage(writer,'ready');go(writer);await blockedChild(writer)
      assert.ok(!writer.records.some(value=>value.stage==='done'));go(holder);assert.equal((await stage(holder,'result')).status,'scheduled');assert.equal((await end(holder)).code,0);await stage(writer,'done');assert.equal((await end(writer)).code,0)
      assert.equal((await outgoing.auditHistory({deliveryId:item.delivery.id})).records[0].actor,'user:'+alice.id)
      await assert.rejects(outgoing.retryFailedAuthorized(crypto.randomUUID(),{expectedMaxAttempts:1,reason:'manual-retry'},async tx=>{const p=await accounts.authenticateInTransaction(tx,item.session.token);if(!p?.user.roles.includes('numbers-operator'))throw new Error('denied');return{actor:'user:'+p.user.id}}),/denied/)
      await outgoing.dispatchOnce({async publish(){}})
    }
    const killed=await seed(),holder=processFor('before-commit',killed);await stage(holder,'ready');go(holder);await stage(holder,'before-commit')
    assert.equal((await outgoing.get(killed.delivery.id)).state,'failed');assert.equal((await outgoing.auditHistory({deliveryId:killed.delivery.id})).records.length,0)
    const revoker=processFor('raw-revoke',killed,true);await stage(revoker,'ready');go(revoker);await blockedChild(revoker)
    assert.equal((await end(holder,'SIGKILL')).signal,'SIGKILL');await stage(revoker,'done');assert.equal((await end(revoker)).code,0)
    assert.equal((await outgoing.get(killed.delivery.id)).maxAttempts,1);assert.equal((await outgoing.auditHistory({deliveryId:killed.delivery.id})).records.length,0)
    // A role update that wins first is observed after the lock wait, despite an earlier request snapshot.
    const changed=await seed();let release,locked
    await assert.rejects(accounts.authenticateInTransaction(db,changed.session.token),/managed transaction/)
    await assert.rejects(owner.transaction(tx=>accounts.authenticateInTransaction(tx,changed.session.token)),/different database/)
    const gate=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{locked=resolve})
    const mutation=owner.transaction(async tx=>{await tx.execute({sql:"UPDATE longhorn_auth.users SET roles='[\"member\"]'::jsonb WHERE id=$1",args:[alice.id]});locked();await gate})
    await ready;const reader=processFor('check',changed);try{await stage(reader,'ready');go(reader);await stage(reader,'checking');await blockedChild(reader)}finally{release();await mutation}
    await stage(reader,'denied');assert.equal((await end(reader)).code,0);assert.equal((await outgoing.auditHistory({deliveryId:changed.delivery.id})).records.length,0)
    // Expiration is checked after ownership is acquired, rather than before the database wait.
    const expiring=await seed(),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expiring.session.token)),hex=Buffer.from(hash).toString('hex')
    let unlock,hasLock;const held=new Promise(resolve=>{unlock=resolve}),owned=new Promise(resolve=>{hasLock=resolve})
    const expires=owner.transaction(async tx=>{await tx.execute({sql:'UPDATE longhorn_auth.sessions SET expires_at=$1 WHERE token_hash=$2',args:[Date.now()+100,hex]});hasLock();await held})
    await owned;const expired=processFor('check',expiring);try{await stage(expired,'ready');go(expired);await stage(expired,'checking');await blockedChild(expired);await new Promise(resolve=>setTimeout(resolve,150))}finally{unlock();await expires}
    await stage(expired,'denied');assert.equal((await end(expired)).code,0)
    console.log('Native PostgreSQL authorization: raw DELETE/UPDATE and trusted provisioning wait on retained principal locks; first-writer role change and expiry deny; SIGKILL rolls back recovery/audit and releases revocation. Restricted runtime still cannot update users or audit history.')
  }finally{await outgoing.close()}
  temporary=await mkdtemp(join(tmpdir(),'longhorn-operator-'))
  await build({entry:{worker:fileURLToPath(new URL('./fixtures/operator-account-worker.mjs',import.meta.url))},outDir:temporary,format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,silent:true})
  objectWorker=new Miniflare({modules:true,modulesRoot:temporary,scriptPath:join(temporary,'worker.js'),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),durableObjects:{ACCOUNTS:{className:'AccountStore',useSQLite:true}}})
  const native=await objectWorker.dispatchFetch('http://operator/run',{method:'POST'}),objectResult=await native.json();assert.equal(native.status,200,JSON.stringify(objectResult))
  assert.equal(objectResult.denied,true);assert.equal(objectResult.deniedAudit,0);assert.equal(objectResult.revoked,true);assert.equal(objectResult.granted,'updated');assert.equal(objectResult.rolledBack,true)
  assert.equal(objectResult.afterAbort.delivery.state,'failed');assert.equal(objectResult.afterAbort.delivery.maxAttempts,1);assert.deepEqual(objectResult.afterAbort.records,[]);assert.equal(objectResult.afterAbort.alarm,null)
  assert.equal(objectResult.result.result.status,'scheduled');assert.equal(objectResult.result.audit.actor,'user:worker-user');assert.equal(objectResult.demoted,true)
  await objectWorker.dispose();objectWorker=undefined
  console.log('Object SQL authorization: actual workerd account/session projection, member denial, role-change revocation, attributed retry and native retry+audit+alarm abort rollback verified without a Worker password provider.')
  await app.close();app=undefined;await broker.dispose();broker=undefined
  const demo=launch('./demo-operator-accounts.mjs',{PORT:'0',AUTH_ORIGIN:origin});await stage(demo,'Account operations demo listening');demo.child.stdin.write('grant absent\n');await stage(demo,'Operator role result');assert.equal((await end(demo,'SIGTERM')).code,0)
  const interrupted=launch('./demo-operator-accounts.mjs',{PORT:'0',AUTH_ORIGIN:origin});await stage(interrupted,'Starting account operations demo');assert.equal((await end(interrupted,'SIGTERM')).code,0);assert.ok(!interrupted.records.some(value=>value.message==='Account operations demo listening'))
  for(const child of children)for(const secret of [...secrets,password,sandbox.appUrl,sandbox.ownerUrl])assert.ok(!child.output().includes(secret),'Private credential was logged')
  console.log('Account demo: production broker host starts over TCP, trusted controls run, normal and startup signals dispose owned resources; no session/password/database credentials appear in child output.')
}finally{
  for(const instance of children)if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance=>instance.ended))
  const cleanup=await Promise.allSettled([app?.close(),broker?.dispose(),objectWorker?.dispose(),...databases.map(db=>db.close())])
  try{await sandbox?.stop()}finally{if(temporary)await rm(temporary,{recursive:true,force:true});const errors=cleanup.filter(value=>value.status==='rejected').map(value=>value.reason);if(errors.length)throw new AggregateError(errors,'Owned operator cleanup failed')}
}
