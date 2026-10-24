import assert from 'node:assert/strict'
import { spawn,execFile } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer,connect } from 'node:net'
import { createHash,randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir,mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { RateLimiter } from '../packages/ratelimit/dist/index.js'
import { RedisRateLimitStore } from '../packages/ratelimit/dist/redis.js'
import { openRedis } from '../runtimes/node/dist/redis.js'
import { startRedisSandbox } from './redis-sandbox.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-redis-limits-')),connections=new Set(),limiters=new Set(),children=[],sockets=new Set(),runtimes=[],secrets=[]
let sandbox,worker,proxy,admin
const sleep=ms=>new Promise(done=>setTimeout(done,ms)),safe=value=>{for(const secret of secrets)value=value.replaceAll(secret,'[redacted]');return value}
const waitFor=async action=>{const end=Date.now()+15000;while(Date.now()<end){const value=await action();if(value)return value;await sleep(10)}throw new Error('Redis request-limit condition timed out')}
const connection=async options=>{const value=await sandbox.open(options);connections.add(value);return value}
const limiter=(client,namespace,scope,limit=1,windowMs=60000)=>{const value=new RateLimiter({scope,limit,windowMs,store:new RedisRateLimitStore(client,{namespace,maxConcurrent:128})});limiters.add(value);return value}
const key=(namespace,scope,subject)=>'longhorn:ratelimit:v1:'+namespace+':'+Buffer.from(scope).toString('base64url')+':'+createHash('sha256').update(JSON.stringify(['longhorn.rate-limit.v1',scope,subject])).digest('hex')
const value=async name=>{const raw=await admin.execute(['GET',name]);return raw===null?null:raw.split(':').slice(1).map(Number)}
function launch(environment={}){
  const child=spawn(process.execPath,['examples/redis-limits/dist/index.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',API_TOKEN:'a'.repeat(64),RATE_LIMIT_SUBJECT:'service-client',RATE_LIMIT_REQUESTS:'2',RATE_LIMIT_WINDOW_MS:'3000',REDIS_NAMESPACE:'api',REDIS_URL:sandbox.url,REDIS_ALLOW_INSECURE_LOOPBACK:'true',...environment},stdio:['ignore','pipe','pipe']}),records=[];let output=''
  for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.once('error',()=>{});const instance={child,records,output:()=>output,ended:new Promise(done=>child.once('close',(code,signal)=>done({code,signal})))};children.push(instance);return instance
}
const listening=instance=>waitFor(()=>{const row=instance.records.find(row=>row.message==='HTTP server listening');if(row)return row.fields.url;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(safe(instance.output()));return false})
async function stop(instance){if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{assert.equal((await instance.ended).code,0,safe(instance.output()));for(const secret of secrets)assert.ok(!instance.output().includes(secret),'Native host exposed supplied data')}finally{clearTimeout(timer)}}
const request=(url,{token='a'.repeat(64),body={numbers:[3,7]},raw,headers={}}={})=>fetch(url+'/reports',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:raw??JSON.stringify(body),signal:AbortSignal.timeout(10000)})
try{
  for(const [runtime,binary,flags]of[['node',process.execPath,[]],['bun',join(root,'node_modules/bun-runtime/bin/bun.exe'),[]],['deno',join(root,'node_modules/deno-runtime/deno'),['run','--no-prompt','--no-lock','--node-modules-dir=manual']]]){
    const result=await promisify(execFile)(binary,[...flags,join(root,'scripts/fixtures/run-redis-ratelimit.mjs')],{cwd:root,timeout:15000});const proof=JSON.parse(result.stdout.trim());assert.equal(proof.runtime,runtime);runtimes.push(proof)
  }
  const bundle=join(temporary,'worker');await build({entry:{worker:join(root,'scripts/fixtures/redis-ratelimit-worker.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  worker=new Miniflare({modules:true,modulesRoot:bundle,scriptPath:join(bundle,'worker.js'),host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE)})
  const response=await worker.dispatchFetch('http://protocol/');assert.equal(response.status,200);runtimes.push(await response.json());await worker.dispose();worker=undefined;assert.ok(runtimes.every(row=>row.serverClock&&row.hono&&row.privacy&&row.reentrantDrain))
  sandbox=await startRedisSandbox();secrets.push(sandbox.url,sandbox.password,'a'.repeat(64),'b'.repeat(64));admin=await connection({maxConcurrent:128})
  const version=/redis_version:([^\r\n]+)/.exec(await admin.execute(['INFO','server']))[1];assert.ok(Number(version.split('.')[0])>=7);assert.equal((await admin.execute(['CONFIG','GET','maxmemory-policy']))[1],'noeviction')
  const one=limiter(await connection({maxConcurrent:128}),'budgets','reports.v1',7,5000),two=limiter(await connection({maxConcurrent:128}),'budgets','reports.v1',7,5000),shared=key('budgets','reports.v1','private principal')
  const decisions=await Promise.all(Array.from({length:80},(_,index)=>(index%2?one:two).consume('private principal')));assert.equal(decisions.filter(row=>row.allowed).length,7);assert.equal(new Set(decisions.map(row=>row.resetsAt)).size,1)
  const retained=await value(shared);assert.deepEqual(retained.slice(0,3),[7,5000,8]);assert.equal(await admin.execute(['PEXPIRETIME',shared]),decisions[0].resetsAt)
  await assert.rejects(limiter(await connection(),'budgets','reports.v1',8,5000).consume('private principal'),error=>error.code==='POLICY_MISMATCH');assert.deepEqual(await value(shared),retained)
  assert.equal((await limiter(await connection(),'neighbor','reports.v1').consume('private principal')).allowed,true);assert.equal((await limiter(await connection(),'budgets','other.v1').consume('private principal')).allowed,true);assert.equal((await one.consume('another principal')).allowed,true)
  const rawStore=new RedisRateLimitStore(await connection(),{namespace:'queued'}),beforeTime=await admin.execute(['TIME']),beforeMs=Number(beforeTime[0])*1000+Math.floor(Number(beforeTime[1])/1000)
  await admin.execute(['CLIENT','PAUSE','300','ALL']);const queued=await rawStore.consume({scope:'queue.v1',key:'1'.repeat(64),limit:1,windowMs:1000});assert.ok(queued.observedAt>=beforeMs+250);assert.equal(queued.resetsAt,queued.observedAt+1000)
  const expiry=limiter(await connection(),'expiry','short.v1',1,1000),expiryKey=key('expiry','short.v1','subject');assert.equal((await expiry.consume('subject')).allowed,true);const deadline=await admin.execute(['PEXPIRETIME',expiryKey]);assert.equal((await expiry.consume('subject')).allowed,false);assert.equal(await admin.execute(['PEXPIRETIME',expiryKey]),deadline);assert.equal(await expiry.prune(1),0);await waitFor(async()=>await admin.execute(['GET',expiryKey])===null);assert.equal((await limiter(await connection(),'expiry','short.v1',2,1000).consume('subject')).allowed,true)
  console.log('Redis '+version+': actual two-connection contention admits seven of 80, preserves live policy/deadline and namespace/subject isolation, samples time after server queueing and expires/replenishes through native TTL.')
  const password=randomBytes(32).toString('hex');secrets.push(password)
  await admin.execute(['ACL','SETUSER','limit-runtime','on','>'+password,'~longhorn:ratelimit:v1:restricted:*','+auth','+select','+ping','+eval','+time','+get','+set','+pexpiretime'])
  const url=new URL(sandbox.url);url.username='limit-runtime';url.password=password;secrets.push(url.href)
  const restricted=await openRedis({url:url.href,allowInsecureLoopback:true});connections.add(restricted);const allowed=limiter(restricted,'restricted','api.v1'),restrictedKey=key('restricted','api.v1','principal');await allowed.consume('principal');const original=await value(restrictedKey)
  await assert.rejects(restricted.execute(['DEL',restrictedKey]),error=>error.code==='command');await assert.rejects(restricted.execute(['GET',shared]),error=>error.code==='command');await assert.rejects(restricted.execute(['SCAN','0']),error=>error.code==='command');assert.equal(await allowed.prune(),0)
  await admin.execute(['ACL','SETUSER','limit-runtime','-set']);try{await assert.rejects(allowed.consume('principal'),error=>error.code==='command');assert.deepEqual(await value(restrictedKey),original)}finally{await admin.execute(['ACL','SETUSER','limit-runtime','+set'])}
  for(const [index,raw,hasExpiry]of[[0,'private malformed state',true],[1,'v1:1:1000:1:9999999999999',false],[2,'v1:01:1000:1:9999999999999',true],[3,'v1:1:1000:1:9999999999999',true]]){
    const name=key('corrupt','api.v1','subject-'+index),args=['SET',name,raw];if(hasExpiry)args.push('PX','60000');await admin.execute(args);const ttl=await admin.execute(['PEXPIRETIME',name]);await assert.rejects(limiter(await connection(),'corrupt','api.v1',1,1000).consume('subject-'+index),error=>error.code==='PROTOCOL');assert.equal(await admin.execute(['GET',name]),raw);assert.equal(await admin.execute(['PEXPIRETIME',name]),ttl)
  }
  const wrongType=key('corrupt','api.v1','wrong-type');await admin.execute(['HSET',wrongType,'private','retained']);await assert.rejects(limiter(await connection(),'corrupt','api.v1',1,1000).consume('wrong-type'),error=>error.code==='command');assert.equal(await admin.execute(['HGET',wrongType,'private']),'retained')
  const restart=limiter(await connection(),'restart','persistent.v1',1,60000);await restart.consume('retained');const restartKey=key('restart','persistent.v1','retained'),beforeCrash=await value(restartKey)
  await Promise.all([...limiters].map(row=>row.close()));limiters.clear();await Promise.all([...connections].map(row=>row.close()));connections.clear();assert.equal((await sandbox.stopServer('SIGKILL')).signal,'SIGKILL');await sandbox.start();admin=await connection();assert.deepEqual(await value(restartKey),beforeCrash);assert.equal((await limiter(await connection(),'restart','persistent.v1',1,60000).consume('retained')).allowed,false)
  console.log('Redis permissions/state: namespace ACL works without DELETE/SCAN, denied SET and malformed state preserve the bucket, and SIGKILL/AOF restart retains a committed live budget.')
  const first=launch(),peer=launch(),firstUrl=await listening(first),peerUrl=await listening(peer),apiKey=key('api','reports.submit.v1','service-client')
  assert.equal((await request(firstUrl,{token:'wrong'})).status,401);assert.equal((await request(firstUrl,{raw:'x'.repeat(9000)})).status,413);assert.equal(await admin.execute(['GET',apiKey]),null)
  assert.equal((await request(firstUrl,{raw:'{'})).status,400);const computed=await request(peerUrl);assert.equal(computed.status,200);assert.deepEqual(await computed.json(),{result:{count:2,sum:10}})
  const blocked=await request(firstUrl,{headers:{'X-Forwarded-For':'another principal'}});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>=1);assert.equal(blocked.headers.get('Cache-Control'),'no-store')
  await stop(first);const rotated=launch({API_TOKEN:'b'.repeat(64)}),rotatedUrl=await listening(rotated);assert.equal((await request(rotatedUrl,{token:'b'.repeat(64)})).status,429)
  await waitFor(async()=>await admin.execute(['GET',apiKey])===null);assert.equal((await request(rotatedUrl,{token:'b'.repeat(64)})).status,200)
  await sandbox.stopServer();await waitFor(async()=>(await fetch(peerUrl+'/readyz')).status===503);assert.equal((await request(peerUrl)).status,503);assert.equal((await fetch(peerUrl+'/livez')).status,200);await stop(peer);await stop(rotated)
  await Promise.all([...connections].map(row=>row.close()));connections.clear();await sandbox.start();admin=await connection();const recovered=launch(),recoveredUrl=await listening(recovered);assert.equal((await fetch(recoveredUrl+'/readyz')).status,200);const afterOutage=await request(recoveredUrl);assert.equal(afterOutage.status,200);assert.deepEqual(await afterOutage.json(),{result:{count:2,sum:10}});await stop(recovered)
  // Hold a real server-committed reply; HTTP/limiter/connection shutdown must await native timeout.
  let hold=false;proxy=createServer(peer=>{sockets.add(peer);peer.on('error',()=>{});const upstream=connect({host:'127.0.0.1',port:sandbox.port});sockets.add(upstream);upstream.on('error',()=>peer.destroy());peer.pipe(upstream);upstream.on('data',data=>{if(!hold)peer.write(data)});upstream.on('end',()=>peer.end());peer.on('close',()=>{sockets.delete(peer);upstream.destroy()});upstream.on('close',()=>sockets.delete(upstream))});await new Promise(done=>proxy.listen(0,'127.0.0.1',done))
  const proxyUrl=new URL(sandbox.url);proxyUrl.port=String(proxy.address().port);secrets.push(proxyUrl.href)
  const delayed=launch({REDIS_URL:proxyUrl.href,REDIS_NAMESPACE:'lost-reply',RATE_LIMIT_REQUESTS:'1',RATE_LIMIT_WINDOW_MS:'60000',REDIS_COMMAND_TIMEOUT_MS:'500'}),delayedUrl=await listening(delayed),delayedKey=key('lost-reply','reports.submit.v1','service-client');hold=true
  const pending=request(delayedUrl);await waitFor(async()=>await admin.execute(['GET',delayedKey])!==null);let ended=false;void delayed.ended.then(()=>{ended=true});delayed.child.kill('SIGTERM');await sleep(30);assert.equal(ended,false);const unavailable=await pending;assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'Request limit is unavailable'});await stop(delayed);assert.equal((await value(delayedKey))[2],1)
  const retry=launch({REDIS_NAMESPACE:'lost-reply',RATE_LIMIT_REQUESTS:'1',RATE_LIMIT_WINDOW_MS:'60000'}),retryUrl=await listening(retry);assert.equal((await request(retryUrl)).status,429);assert.equal((await value(delayedKey))[2],2);await stop(retry)
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/redis-rate-limit-proof.json',JSON.stringify({redisVersion:version,runtimes,actualNodeTcp:true,concurrentAttempts:80,admitted:7,serverQueueClock:true,nativeExpiry:true,policyPreserved:true,namespaceAndSubjectIsolation:true,restrictedAcl:true,deniedWritePreserved:true,malformedStatePreserved:true,sigkillAofRetained:true,twoHttpHosts:true,trustedIdentity:true,invalidAttemptsCount:true,keyRotationRetainsBudget:true,outageAndExplicitRecovery:true,lostReplyCommittedOnce:true,actualHttpShutdownDrain:true,noPrivateOutput:true},null,2)+'\n')
  console.log('Redis limit API: actual two-host bearer guards and computed reports, counted invalid input, 429 across key rotation, native expiry, outage/explicit restart recovery and committed lost-reply 503/native shutdown drain without reconnect or double reservation verified.')
}finally{
  for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null){child.child.kill('SIGTERM');const timer=setTimeout(()=>child.child.kill('SIGKILL'),10000);try{await child.ended}finally{clearTimeout(timer)}}
  for(const socket of sockets)socket.destroy();if(proxy)await new Promise(done=>proxy.close(done));await worker?.dispose();await Promise.all([...limiters].map(row=>row.close()));await Promise.all([...connections].map(row=>row.close()));await sandbox?.close();await rm(temporary,{recursive:true,force:true})
}
