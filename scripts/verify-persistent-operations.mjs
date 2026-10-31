import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { mkdtemp,rm,readFile } from 'node:fs/promises'
import { join,dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { createHttpPublisher } from '../packages/outbox/dist/http.js'

const children=[],temporary=await mkdtemp(join(tmpdir(),'longhorn-persistent-operations-')),origin='http://127.0.0.1:3011',password='owned persistent account password'
let sandbox,database,owner,proxy,upstream,releaseAck,holdId,ackCommitted,notifyAck,worker,token=randomBytes(32).toString('hex')
const secrets=[token,password],pending=new Set()
const waitFor=async predicate=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Persistent operations condition did not settle')}
function launch(script,extra={},args=[],binary=process.execPath,flags=[]){
  const environment={...process.env,...extra};if(!Object.hasOwn(extra,'MIGRATION_DATABASE_URL'))delete environment.MIGRATION_DATABASE_URL
  const child=spawn(binary,[...flags,fileURLToPath(new URL(script,import.meta.url)),...args],{env:environment,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']}),records=[];let output=''
  createInterface({input:child.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.stderr.on('data',chunk=>{output+=chunk});child.on('error',()=>{})
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),instance={child,records,ended,output:()=>output};children.push(instance);return instance
}
const listening=instance=>waitFor(()=>{const found=instance.records.find(value=>value.message==='HTTP server listening');if(found)return found.fields.url;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error('Owned host exited before listening');return false})
function forceOwnedGroup(instance){
  if(instance.cleaned)return
  instance.cleaned=true
  if(!instance.child.pid)return
  try{if(process.platform==='win32')instance.child.kill('SIGKILL');else process.kill(-instance.child.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}
}
async function end(instance,signal){if(signal)instance.child.kill(signal);const timer=setTimeout(()=>forceOwnedGroup(instance),10000);try{return await instance.ended}finally{clearTimeout(timer);forceOwnedGroup(instance)}}
const post=(body,cookie)=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
const auth=()=>({headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)})
async function startReceiver(port='0'){
  const instance=launch('./serve-message-receiver.mjs',{HOST:'127.0.0.1',PORT:port,RECEIVER_TOKEN:token,RECEIVER_DATA_PATH:join(temporary,'receipts')})
  const url=await listening(instance);upstream=url;return{instance,url}
}
try{
  const packed=JSON.parse(await readFile(new URL('../cli/dist/framework/outbox/package.json',import.meta.url),'utf8'))
  assert.ok(packed.exports['./http']);assert.ok(packed.dependencies['@longhornjs/http'])
  assert.match(await readFile(new URL('../cli/dist/framework/http/dist/client.d.ts',import.meta.url),'utf8'),/createJsonClient/)
  assert.match(await readFile(new URL('../cli/dist/framework/auth/dist/bearer.d.ts',import.meta.url),'utf8'),/createBearerVerifier/)
  sandbox=await startAccountOperationsSandbox();secrets.push(sandbox.ownerUrl,sandbox.appUrl)
  database=await openPostgres({connectionString:sandbox.appUrl})
  let receiver=await startReceiver()
  const require=createRequire(import.meta.url),runtimeScript='./fixtures/http-delivery-runtime.mjs'
  const bun=join(dirname(require.resolve('bun-runtime/package.json')),'bin/bun.exe'),deno=join(dirname(require.resolve('deno-runtime/package.json')),process.platform==='win32'?'deno.exe':'deno')
  for(const [binary,flags] of [[process.execPath,[]],[bun,[]],[deno,['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-net=127.0.0.1','--allow-env=SERVICE_URL,SERVICE_TOKEN']]]){
    const instance=launch(runtimeScript,{SERVICE_URL:receiver.url+'/',SERVICE_TOKEN:token},[],binary,flags)
    const ended=await end(instance),diagnostics=secrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),instance.output())
    assert.equal(ended.code,0,diagnostics);assert.deepEqual(instance.records.at(-1),{httpDelivery:true,deduplicated:true,protectedReceipt:true})
  }
  await build({entry:{worker:fileURLToPath(new URL('./fixtures/http-delivery-contract.mjs',import.meta.url))},outDir:join(temporary,'contract'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,silent:true})
  worker=new Miniflare({modules:true,modulesRoot:join(temporary,'contract'),scriptPath:join(temporary,'contract/worker.js'),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),bindings:{SERVICE_URL:receiver.url+'/',SERVICE_TOKEN:token}})
  const nativeContract=await worker.dispatchFetch('http://contract/');assert.equal(nativeContract.status,200);assert.deepEqual(await nativeContract.json(),{httpDelivery:true,deduplicated:true,protectedReceipt:true});await worker.dispose();worker=undefined
  console.log('HTTP delivery portability: built JSON client/publisher use real TCP and bearer-protected SQL receipts on Node, Bun, Deno and workerd.')
  assert.equal((await fetch(receiver.url+'/health')).status,401)
  assert.equal((await fetch(receiver.url+'/messages',{method:'POST',body:'not json'})).status,401)
  assert.equal((await fetch(receiver.url+'/receipts/not-a-uuid')).status,401)
  const controlMessage={id:crypto.randomUUID(),topic:'command.numbers.v1',data:{commandId:crypto.randomUUID(),numbers:[3,7]}}
  const direct=createHttpPublisher({baseUrl:receiver.url+'/',token,allowInsecureLoopback:true}),context={attempt:1,maxAttempts:3,signal:new AbortController().signal}
  await Promise.all([direct.publish(controlMessage,context),direct.publish(controlMessage,context),direct.publish(controlMessage,context)])
  await assert.rejects(direct.publish({...controlMessage,data:{...controlMessage.data,numbers:[999]}},context),error=>error.code==='http'&&error.status===409)
  let receipt=await(await fetch(receiver.url+'/receipts/'+controlMessage.data.commandId,auth())).json();assert.equal(receipt.receipts.length,1);assert.equal(receipt.receipts[0].result.sum,10)
  const many=crypto.randomUUID()
  for(let offset=0;offset<101;offset+=10)await Promise.all(Array.from({length:Math.min(10,101-offset)},()=>direct.publish({id:crypto.randomUUID(),topic:'command.numbers.v1',data:{commandId:many,numbers:[1]}},context)))
  assert.equal((await fetch(receiver.url+'/receipts/'+many,auth())).status,413)
  assert.equal((await end(receiver.instance,'SIGTERM')).code,0);receiver=await startReceiver()
  assert.deepEqual(await(await fetch(receiver.url+'/receipts/'+controlMessage.data.commandId,auth())).json(),receipt)
  console.log('Durable HTTP receiver: unauthorized requests stop before validation; acknowledged effects dedupe stable IDs, reject conflicting effects and persist across an actual process restart.')

  proxy=createServer((request,response)=>{
    const work=(async()=>{
      let body='';for await(const chunk of request)body+=chunk
      const target=new URL(request.url,upstream),result=await fetch(target,{method:request.method,headers:{Authorization:request.headers.authorization??'','Content-Type':'application/json'},...(body?{body}:{}),signal:AbortSignal.timeout(10000)})
      const text=await result.text()
      if(request.url==='/messages'&&result.status===200&&holdId&&JSON.parse(body).id===holdId){notifyAck();await ackCommitted}
      if(!response.destroyed){response.writeHead(result.status,{'Content-Type':'application/json'});response.end(text)}
    })().catch(()=>{if(!response.destroyed){response.writeHead(503,{'Content-Type':'application/json'});response.end('{"error":"Owned service unavailable"}')}})
    pending.add(work);void work.finally(()=>pending.delete(work))
  })
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve)})
  const serviceUrl='http://127.0.0.1:'+proxy.address().port+'/'
  const environment={DATABASE_URL:sandbox.appUrl,HOST:'127.0.0.1',PORT:'0',AUTH_ORIGIN:origin,AUTH_COOKIE_SECURE:'false',LOG_LEVEL:'info',MESSAGE_SERVICE_URL:serviceUrl,MESSAGE_SERVICE_TOKEN:token,MESSAGE_ALLOW_INSECURE_LOOPBACK:'true',MESSAGE_HTTP_TIMEOUT_MS:'3000',PG_MAX_CONNECTIONS:'5'}
  for(const extra of [{MIGRATION_DATABASE_URL:sandbox.ownerUrl},{DATABASE_URL:sandbox.ownerUrl},{MESSAGE_SERVICE_TOKEN:'short'},{MESSAGE_SERVICE_URL:'http://external.invalid/'}]){
    const failed=launch('../examples/postgres/dist/operator-host.js',{...environment,...extra});assert.equal((await end(failed)).code,1);assert.ok(!failed.records.some(value=>value.message==='HTTP server listening'))
  }
  owner=await openPostgres({connectionString:sandbox.ownerUrl})
  for(const [grant,revoke] of [
    ['GRANT UPDATE(password_hash) ON longhorn_auth.users TO longhorn_app','REVOKE UPDATE(password_hash) ON longhorn_auth.users FROM longhorn_app'],
    ['GRANT UPDATE(actor) ON longhorn_outbox.recovery_audit TO longhorn_app','REVOKE UPDATE(actor) ON longhorn_outbox.recovery_audit FROM longhorn_app'],
  ]){
    await owner.execute(grant)
    try{const rejected=launch('../examples/postgres/dist/operator-host.js',environment);assert.equal((await end(rejected)).code,1)}finally{await owner.execute(revoke)}
  }
  await owner.close();owner=undefined
  const startHost=async enabled=>{const instance=launch('../examples/postgres/dist/operator-host.js',{...environment,MESSAGE_SERVICE_TOKEN:token,DISPATCH_ENABLED:String(enabled)});return{instance,url:await listening(instance)}}
  let host=await startHost(false)
  const shell=await fetch(host.url+'/console');assert.equal(shell.status,200);assert.equal(shell.headers.get('Cache-Control'),'no-store');assert.ok(shell.headers.get('Content-Security-Policy').includes("connect-src 'self'"));assert.ok((await shell.text()).includes('/console/app.js'))
  for(const [path,type] of [['app.js','text/javascript'],['app.css','text/css']]){const asset=await fetch(host.url+'/console/'+path);assert.equal(asset.status,200);assert.ok(asset.headers.get('Content-Type').includes(type));assert.ok((await asset.text()).length>100)}
  const login=async(username,cookie)=>{const response=await fetch(host.url+'/account/login',post({username,password},cookie));assert.equal(response.status,200);const value=await response.json(),credential=response.headers.get('set-cookie').split(';')[0];secrets.push(credential.split('=')[1]);return{cookie:credential,user:value.user}}
  for(const username of ['alice','bobby'])assert.equal((await fetch(host.url+'/account/register',post({username,password}))).status,201)
  const grant=launch('../examples/postgres/dist/operator-role.js',{MIGRATION_DATABASE_URL:sandbox.ownerUrl},['grant','alice']);assert.equal((await end(grant)).code,0)
  const operator=await login('alice'),member=await login('bobby'),input={id:'restart-command',numbers:[2,4,8]}
  const commandResponse=await fetch(host.url+'/account/commands',post(input,member.cookie));assert.equal(commandResponse.status,201);const command=await commandResponse.json()
  assert.equal((await fetch(host.url+'/account/commands/'+command.command.id,{headers:{Cookie:operator.cookie}})).status,200)
  assert.equal((await end(host.instance,'SIGTERM')).code,0)
  host=await startHost(false)
  const replay=await fetch(host.url+'/account/commands',post(input,member.cookie));assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),command)
  assert.equal((await fetch(host.url+'/account/operations/deliveries/'+command.delivery.id,{headers:{Cookie:operator.cookie}})).status,200)
  assert.equal((await end(host.instance,'SIGTERM')).code,0)

  // Drop the publisher process after the receiver committed, but before its acknowledgement returns.
  holdId=command.delivery.id;ackCommitted=new Promise(resolve=>{releaseAck=resolve})
  const receiverCommitted=new Promise(resolve=>{notifyAck=resolve})
  host=await startHost(true)
  let boundaryTimer
  try{await Promise.race([receiverCommitted,new Promise((_,reject)=>{boundaryTimer=setTimeout(()=>reject(new Error('No committed acknowledgement boundary')),10000)})])}finally{clearTimeout(boundaryTimer)}
  receipt=await(await fetch(receiver.url+'/receipts/'+command.command.id,auth())).json();assert.equal(receipt.receipts.length,1);assert.equal(receipt.receipts[0].messageId,command.delivery.id)
  assert.equal((await end(host.instance,'SIGKILL')).signal,'SIGKILL');releaseAck();holdId=undefined
  const killed=(await database.execute({sql:'SELECT state FROM longhorn_queue.jobs WHERE id=$1',args:[command.delivery.id]})).rows[0];assert.equal(killed.state,'running')
  host=await startHost(true)
  const inspect=async id=>{const response=await fetch(host.url+'/account/operations/deliveries/'+id,{headers:{Cookie:operator.cookie}});assert.equal(response.status,200);return(await response.json()).delivery}
  const recovered=await waitFor(async()=>{const value=await inspect(command.delivery.id);return value.state==='succeeded'?value:false});assert.ok(recovered.attempts>=2)
  assert.deepEqual(await(await fetch(receiver.url+'/receipts/'+command.command.id,auth())).json(),receipt)
  const memberReceipt=await fetch(host.url+'/account/commands/'+command.command.id+'/receipt',{headers:{Cookie:member.cookie}});assert.equal(memberReceipt.status,200);assert.equal(memberReceipt.headers.get('cache-control'),'no-store')
  assert.ok(!memberReceipt.headers.has('set-cookie'));assert.deepEqual(await memberReceipt.json(),receipt)
  console.log('Persistent account host: separate runtime/owner credentials, live sessions/roles, user-scoped replay across restart, SIGKILL after remote commit, native lease recovery and one stable-ID consumer effect verified.')

  // Receiver outage becomes dependency-unready and exhausts a separate delivery for deliberate audited recovery.
  assert.equal((await end(receiver.instance,'SIGTERM')).code,0)
  await waitFor(async()=> (await fetch(host.url+'/readyz')).status===503)
  assert.equal((await fetch(host.url+'/livez')).status,200)
  const unavailable=await fetch(host.url+'/account/commands/'+command.command.id+'/receipt',{headers:{Cookie:member.cookie}});assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes(token))
  const secondInput={id:'outage-command',numbers:[10,20]},secondResponse=await fetch(host.url+'/account/commands',post(secondInput,member.cookie));assert.equal(secondResponse.status,201);const secondCommand=await secondResponse.json()
  const failed=await waitFor(async()=>{const value=await inspect(secondCommand.delivery.id);return value.state==='failed'?value:false})
  assert.equal((await end(host.instance,'SIGTERM')).code,0)
  const oldToken=token;token=randomBytes(32).toString('hex');secrets.push(token);receiver=await startReceiver()
  assert.equal((await fetch(receiver.url+'/receipts/'+command.command.id,{headers:{Authorization:'Bearer '+oldToken}})).status,401)
  assert.deepEqual(await(await fetch(receiver.url+'/receipts/'+command.command.id,auth())).json(),receipt)
  host=await startHost(true);await waitFor(async()=> (await fetch(host.url+'/readyz')).status===200)
  const retry=await fetch(host.url+'/account/operations/deliveries/'+secondCommand.delivery.id+'/retry',post({expectedMaxAttempts:failed.maxAttempts,additionalAttempts:1,reason:'provider-restored'},operator.cookie))
  assert.equal(retry.status,202);const audited=await retry.json();assert.equal(audited.audit.actor,'user:'+operator.user.id)
  await waitFor(async()=>{const value=await inspect(secondCommand.delivery.id);return value.state==='succeeded'})
  const secondReceipt=await(await fetch(host.url+'/account/commands/'+secondCommand.command.id+'/receipt',{headers:{Cookie:member.cookie}})).json();assert.equal(secondReceipt.receipts.length,1);assert.equal(secondReceipt.receipts[0].result.sum,30)
  const history=await(await fetch(host.url+'/account/operations/audit?deliveryId='+secondCommand.delivery.id,{headers:{Cookie:operator.cookie}})).json();assert.equal(history.records.length,1);assert.equal(history.records[0].id,audited.audit.id)
  assert.equal((await end(host.instance,'SIGTERM')).code,0);assert.equal((await end(receiver.instance,'SIGTERM')).code,0)
  receiver=await startReceiver();host=await startHost(false)
  assert.deepEqual(await(await fetch(host.url+'/account/operations/audit?deliveryId='+secondCommand.delivery.id,{headers:{Cookie:operator.cookie}})).json(),history)
  assert.deepEqual(await(await fetch(host.url+'/account/commands/'+secondCommand.command.id+'/receipt',{headers:{Cookie:member.cookie}})).json(),secondReceipt)
  const replayAfter=await fetch(host.url+'/account/commands',post(secondInput,member.cookie));assert.equal(replayAfter.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replayAfter.json(),secondCommand)
  assert.equal((await end(host.instance,'SIGTERM')).code,0);assert.equal((await end(receiver.instance,'SIGTERM')).code,0)
  const forced=await startReceiver();assert.equal((await end(forced.instance,'SIGKILL')).signal,'SIGKILL')
  const checked=await startReceiver();assert.deepEqual(await(await fetch(checked.url+'/receipts/'+command.command.id,auth())).json(),receipt);assert.equal((await end(checked.instance,'SIGTERM')).code,0)
  for(const instance of children)for(const secret of secrets)assert.ok(!instance.output().includes(secret),'A private credential was logged')
  console.log('Outage/recovery: dependency readiness, sanitized receipt failures, rotated receiver credential, account-attributed deliberate retry, commands/history/receipts after both hosts restart and producer-only startup verified without credential output.')
}finally{
  releaseAck?.()
  await Promise.allSettled(children.map(instance=>end(instance,instance.child.exitCode===null&&instance.child.signalCode===null?'SIGTERM':undefined)));await Promise.allSettled([...pending])
  await worker?.dispose()
  if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve))}
  try{await database?.close()}finally{try{await owner?.close()}finally{try{await sandbox?.stop()}finally{await rm(temporary,{recursive:true,force:true})}}}
}
