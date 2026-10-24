import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {mkdtemp,mkdir,rm,writeFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'tsup'
import {Miniflare,Log,LogLevel} from 'miniflare'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-object-limits-')),held=new Map(),children=[],workers=[]
let gateway
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),sleep=ms=>new Promise(done=>setTimeout(done,ms))
const waitFor=async action=>{const end=Date.now()+15000;while(Date.now()<end){const value=await action();if(value)return value;await sleep(10)}throw new Error('Object request limit native condition timed out')}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://owned'+path,options),body=await response.text();assert.ok(response.ok,path+': '+response.status+' '+body);return JSON.parse(body)}
async function make(fixture,bindings={}){
 const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))]))
 const options={modules:true,modulesRoot:dirname(fixture),scriptPath:fixture,host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE),durableObjects:{COUNTERS:{className:'CounterFixture',useSQLite:true},PLAIN:{className:'PlainFixture',useSQLite:true},ALARMS:{className:'AlarmFixture',useSQLite:true},DRAIN:{className:'HttpDrainFixture',useSQLite:true}},durableObjectsPersist:join(temporary,'retained'),bindings:{GATE_URL:'http://127.0.0.1:'+gateway.address().port,REPORT_LIMIT_ENABLED:'true',REPORT_LIMIT_REQUESTS:'3',REPORT_LIMIT_WINDOW_MS:'60000',ALARM_WINDOW_MS:'5000',...bindings}}
 const worker=new Miniflare(options);workers.push(worker)
 for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
 try{await worker.ready;return worker}catch(error){await worker.dispose();throw error}
}
async function dispose(worker){await worker.dispose();workers.splice(workers.indexOf(worker),1)}
function launch(role,environment={}){
 const child=spawn(process.execPath,['scripts/serve-'+(role==='alarm'?'alarm':'durable')+'-worker.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',REPORT_LIMIT_ENABLED:'true',REPORT_LIMIT_REQUESTS:'1',REPORT_LIMIT_WINDOW_MS:'60000',...(role==='alarm'?{ALARM_DATA_PATH:join(temporary,'alarm-host')}:{DURABLE_DATA_PATH:join(temporary,'plain-host')}),...environment},stdio:['ignore','pipe','pipe']}),records=[];let output=''
 for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
 child.once('error',()=>{});const instance={child,records,output:()=>output,ended:new Promise(done=>child.once('close',(code,signal)=>done({code,signal})))};children.push(instance);return instance
}
async function stop(instance){if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),10000);try{assert.equal((await instance.ended).code,0,instance.output())}finally{clearTimeout(timer)}}
const listening=(instance,enabled=true)=>waitFor(()=>{const record=instance.records.find(row=>row.message==='HTTP server listening');if(record){assert.equal(record.fields.requestLimitsEnabled,enabled);return record.fields.url}if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());return false})
try{
 gateway=createServer((request,response)=>{held.set(request.url,response);response.on('close',()=>{if(held.get(request.url)===response)held.delete(request.url)})});await new Promise(done=>gateway.listen(0,'127.0.0.1',done))
 await build({entry:{worker:join(root,'scripts/fixtures/object-ratelimit.mjs')},outDir:join(temporary,'fixture'),bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true});const fixture=join(temporary,'fixture/worker.js')
 let worker=await make(fixture,{LEGACY:'true'}),prefixes={}
 for(const profile of['plain','alarm']){
  const before=await json(worker,'/'+profile+'/_legacy');assert.equal(before.quotaTable,false);const after=await json(worker,'/'+profile+'/_bad-upgrade',post({}));assert.equal(after.quotaTable,false);assert.deepEqual(after.history,before.history);assert.deepEqual(after.effects,before.effects);prefixes[profile]=before
 }
 await dispose(worker);worker=await make(fixture)
 for(const profile of['plain','alarm']){const upgraded=await json(worker,'/'+profile+'/_inspect');assert.deepEqual(upgraded.history.slice(0,prefixes[profile].history.length),prefixes[profile].history);assert.equal(upgraded.history.at(-1).id,'longhorn_rate_limit/001_buckets');assert.deepEqual(upgraded.effects,prefixes[profile].effects);assert.equal(upgraded.quota.length,0)}
 console.log('Object limit schema: actual previous scheduled/alarm prefixes and effect rows survive native failed suffixes, then append the unchanged SQLite bucket schema after each complete profile.')
 const reservation={scope:'concurrent.v1',subject:'private principal',limit:5,windowMs:60000},responses=await Promise.all(Array.from({length:40},()=>worker.dispatchFetch('http://owned/counter/consume',post(reservation)))),values=await Promise.all(responses.map(response=>response.json()));assert.equal(values.filter(row=>row.allowed===true).length,5);assert.equal(values.filter(row=>row.allowed===false).length,35);assert.equal(new Set(values.map(row=>row.resetsAt)).size,1)
 const counterState=()=>json(worker,'/counter/state'),find=(state,scope)=>state.rows.find(row=>row.scope===scope)
 let snapshot=await counterState(),counter=find(snapshot,reservation.scope);assert.equal(counter.attempts,6);assert.match(counter.subject_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(counter).includes(reservation.subject));const boot=snapshot.boot
 let response=await worker.dispatchFetch('http://owned/counter/consume',post({...reservation,limit:6}));assert.equal(response.status,503);assert.equal((await response.json()).code,'POLICY_MISMATCH');assert.deepEqual(find(await counterState(),reservation.scope),counter);assert.equal((await counterState()).boot,boot)
 const waiting={scope:'waiting.v1',subject:'wait',limit:2,windowMs:1000};assert.equal((await json(worker,'/counter/consume',post(waiting))).resetsAt,1100)
 const hold=json(worker,'/counter/hold',post({scope:waiting.scope}));await waitFor(()=>held.has('/input-gate'));let finished=false;const queued=json(worker,'/counter/consume',post(waiting)).then(value=>{finished=true;return value});await sleep(25);assert.equal(finished,false);held.get('/input-gate').end('2000');await hold;assert.deepEqual(await queued,{allowed:true,remaining:1,resetsAt:3000,retryAfterMs:0});await json(worker,'/counter/time',post({now:100}))
 const fault={scope:'rollback.v1',subject:'fault',limit:2,windowMs:60000};await json(worker,'/counter/consume',post(fault));const priorFault=find(await counterState(),fault.scope);response=await worker.dispatchFetch('http://owned/counter/fault',post(fault));assert.equal(response.status,503);assert.equal((await response.json()).original,true);assert.deepEqual(find(await counterState(),fault.scope),priorFault);assert.equal((await json(worker,'/counter/consume',post(fault))).allowed,true)
 const interrupted={scope:'abort-before.v1',subject:'interrupted',limit:2,windowMs:60000};await json(worker,'/counter/consume',post(interrupted));const beforeAbort=await counterState();assert.ok(!(await worker.dispatchFetch('http://owned/counter/abort-before',post(interrupted))).ok);snapshot=await counterState();assert.notEqual(snapshot.boot,beforeAbort.boot);assert.deepEqual(find(snapshot,interrupted.scope),find(beforeAbort,interrupted.scope))
 const committed={scope:'abort-after.v1',subject:'committed',limit:1,windowMs:60000};assert.ok(!(await worker.dispatchFetch('http://owned/counter/abort-after',post(committed))).ok);assert.equal(find(await counterState(),committed.scope).attempts,1);assert.equal((await json(worker,'/counter/consume',post(committed))).allowed,false)
 assert.ok(Object.values(await json(worker,'/cleanup/cleanup',post({}))).every(Boolean))
 const closing=json(worker,'/close/close',post({}));await waitFor(()=>held.has('/limiter-drain'));let closed=false;void closing.then(()=>{closed=true});await sleep(25);assert.equal(closed,false);held.get('/limiter-drain').end('release');assert.ok(Object.values(await closing).every(Boolean))
 const draining=json(worker,'/drain/drain',post({}));await waitFor(()=>held.has('/http-drain'));let drained=false;void draining.then(()=>{drained=true});await sleep(25);assert.equal(drained,false);held.get('/http-drain').end('release');assert.ok(Object.values(await draining).every(Boolean))
 const persisted=(await counterState()).rows;await dispose(worker);worker=await make(fixture);assert.deepEqual((await counterState()).rows,persisted)
 console.log('Object SQLite limits: five of 40 clients, native input-gate clock wait, policy/SQL rollback without reset, real abort before/after commit, workerd persistence, bounded pruning and actual limiter/HTTP/database drain verified.')
 // Direct jobs and schedule requests consume one shared public Object budget.
 assert.equal((await worker.dispatchFetch('http://owned/plain/reports',{...post({}),body:'x'.repeat(17000)})).status,413);assert.equal((await json(worker,'/plain/_inspect')).quota.length,0)
 const job=await json(worker,'/plain/reports',post({numbers:[3,5]})),schedule={id:'budget-schedule',numbers:[1,2],at:0};await json(worker,'/plain/report-schedules',post(schedule));assert.equal((await worker.dispatchFetch('http://owned/plain/reports',post({numbers:[]}))).status,400)
 const beforeDeny=await json(worker,'/plain/_inspect');response=await worker.dispatchFetch('http://owned/plain/report-schedules',post({...schedule,id:'blocked'}));assert.equal(response.status,429);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(Number(response.headers.get('Retry-After'))>=1);assert.equal((await worker.dispatchFetch('http://owned/plain/reports',post({numbers:[99]}))).status,429)
 let afterDeny=await json(worker,'/plain/_inspect');assert.deepEqual(afterDeny.jobs,beforeDeny.jobs);assert.deepEqual(afterDeny.schedules,beforeDeny.schedules);assert.deepEqual(afterDeny.effects,beforeDeny.effects);assert.equal(afterDeny.quota[0].attempts,4)
 assert.deepEqual(await json(worker,'/plain/_tick',{method:'POST'}),{dispatched:1,processed:2});assert.equal((await json(worker,'/plain/reports/'+job.job.id)).result.sum,8);assert.equal((await json(worker,'/plain/reports/scheduled:budget-schedule:0')).result.sum,3);assert.equal((await json(worker,'/plain/_inspect')).quota[0].attempts,4)
 // Empty/invalid quota work creates no alarm; an existing future alarm never slides on denial.
 assert.equal((await worker.dispatchFetch('http://owned/alarm/reports',post({numbers:[]}))).status,400);assert.equal((await json(worker,'/alarm/_inspect')).alarm,null)
 const future={id:'alarm-budget',numbers:[2,4,6],at:Date.now()+2000};await json(worker,'/alarm/report-schedules',post(future));await json(worker,'/alarm/report-schedules',post(future));const beforeAlarm=await json(worker,'/alarm/_inspect');assert.ok(Math.abs(beforeAlarm.alarm-future.at)<=1)
 assert.equal((await worker.dispatchFetch('http://owned/alarm/reports',post({numbers:[99]}))).status,429);assert.equal((await worker.dispatchFetch('http://owned/alarm/report-schedules',post({...future,id:'blocked-alarm'}))).status,429)
 const deniedAlarm=await json(worker,'/alarm/_inspect');assert.equal(deniedAlarm.alarm,beforeAlarm.alarm);assert.deepEqual(deniedAlarm.schedules,beforeAlarm.schedules);assert.deepEqual(deniedAlarm.jobs,beforeAlarm.jobs)
 await waitFor(async()=>{const response=await worker.dispatchFetch('http://owned/alarm/reports/scheduled:alarm-budget:'+future.at);if(response.status===404)return false;assert.equal(response.status,200);return(await response.json()).result?.sum===12});assert.equal((await json(worker,'/alarm/_inspect')).quota[0].attempts,4)
 const quotaBeforeRestart=(await json(worker,'/alarm/_inspect')).quota;await dispose(worker);worker=await make(fixture);assert.deepEqual((await json(worker,'/alarm/_inspect')).quota,quotaBeforeRestart);assert.equal((await worker.dispatchFetch('http://owned/alarm/reports',post({numbers:[7,9]}))).status,429)
 const replenished=await waitFor(async()=>{const response=await worker.dispatchFetch('http://owned/alarm/reports',post({numbers:[7,9]}));if(response.status===429)return false;assert.equal(response.status,202);return response.json()});await waitFor(async()=>(await json(worker,'/alarm/reports/'+replenished.job.id)).result?.sum===16)
 console.log('Object report policies: shared job/schedule attempts, counted validation/repeated schedules, 429 without effects, scheduled/automatic results under exhausted quota, no quota alarm or shifted wakeup, native restart retention and expiry replenishment verified.')
 await dispose(worker)
 // Real shipped Node owners forward flags and retain state across actual separate host processes.
 for(const role of['plain','alarm']){
  let host=launch(role),url=await listening(host);let response=await fetch(url+'/reports',post({numbers:[10,14]}));assert.equal(response.status,202);const firstJob=(await response.json()).job
  const spoof={...post({numbers:[1]}),headers:{'Content-Type':'application/json','X-Forwarded-For':'another principal'}};assert.equal((await fetch(url+'/reports',spoof)).status,429);assert.equal((await fetch(url+'/_tick',post({}))).status,404);assert.equal((await fetch(url+'/health')).status,200)
  if(role==='plain')assert.equal((await fetch(url+'/cdn-cgi/mf/scheduled?cron=*+*+*+*+*')).status,200)
  await waitFor(async()=>(await(await fetch(url+'/reports/'+firstJob.id)).json()).result?.sum===24);await stop(host)
  host=launch(role);url=await listening(host);assert.equal((await fetch(url+'/report-schedules',post({id:'must-not-reset',numbers:[1],at:0}))).status,429);await stop(host)
  host=launch(role,{REPORT_LIMIT_ENABLED:'false'});url=await listening(host,false);response=await fetch(url+'/reports',post({numbers:[5,6]}));assert.equal(response.status,202);const disabledJob=(await response.json()).job
  if(role==='plain')assert.equal((await fetch(url+'/cdn-cgi/mf/scheduled?cron=*+*+*+*+*')).status,200)
  await waitFor(async()=>(await(await fetch(url+'/reports/'+disabledJob.id)).json()).result?.sum===11);await stop(host)
  host=launch(role);url=await listening(host);assert.equal((await fetch(url+'/reports',post({numbers:[1]}))).status,429);assert.equal((await(await fetch(url+'/reports/'+disabledJob.id)).json()).result.sum,11);await stop(host)
  host=launch(role,{REPORT_LIMIT_REQUESTS:'2'});url=await listening(host);response=await fetch(url+'/reports',post({numbers:[1]}));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Request limit is unavailable'});await stop(host)
  const directory=join(temporary,'invalid-'+role),bad=launch(role,{REPORT_LIMIT_REQUESTS:'0',...(role==='plain'?{DURABLE_DATA_PATH:directory}:{ALARM_DATA_PATH:directory})});assert.equal((await bad.ended).code,1);await assert.rejects(access(directory))
 }
 await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/object-rate-limit-proof.json',JSON.stringify({actualWorkerdSqlite:true,managedStoreReused:true,oldProfilesPreserved:true,nativeDdlRollback:true,concurrentAttempts:40,admitted:5,inputGateClockWait:true,policyAndSqlRollback:true,nativeAbortBeforeAfterCommit:true,workerdPersistence:true,boundedPruning:true,reentrantClose:true,httpDatabaseDrain:true,sharedDirectAndScheduleBudget:true,denialsHaveNoBusinessEffect:true,backgroundWorkUnaffected:true,noQuotaAlarm:true,existingWakeupNotShifted:true,actualComputedSums:[8,3,12,16,24,11],nativeExpiry:true,separateShippedHosts:true,disableReenableRetainsBudget:true,hostPolicyMismatchFailsClosed:true,forwardedIdentityIgnored:true,earlyPrivateConfigFailure:true},null,2)+'\n')
 console.log('Object limit hosts: actual scheduled/alarm executables validate/forward opt-in settings, preserve budgets through separate processes, keep private tick routing and reject invalid config before data acquisition.')
}finally{
 for(const response of held.values())response.end('release');for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null){child.child.kill('SIGTERM');const timer=setTimeout(()=>child.child.kill('SIGKILL'),10000);try{await child.ended}finally{clearTimeout(timer)}}
 for(const worker of [...workers])await dispose(worker);gateway?.closeAllConnections();if(gateway)await new Promise(done=>gateway.close(done));await rm(temporary,{recursive:true,force:true})
}
