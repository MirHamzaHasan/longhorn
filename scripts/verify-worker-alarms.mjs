import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-worker-alarms-'))
const workers=[],held=new Map(),notifications=[];let gateway,host,hostEnded
const NOW=2500000000000,post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
const waitFor=async predicate=>{const deadline=Date.now()+9000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Owned alarm condition did not settle')}
async function make(scriptPath,namespace,className,name,extra={}){
  const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),
    durableObjects:{[namespace]:{className,useSQLite:true}},durableObjectsPersist:join(temporary,name),...extra})
  workers.push(worker);await worker.ready;return worker
}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
async function json(worker,path,options){const response=await worker.dispatchFetch('http://alarms.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
const state=worker=>json(worker,'/state'),reset=worker=>json(worker,'/reset',post({}))
try{
  gateway=createServer((request,response)=>{
    if(request.url==='/native-alarm'){notifications.push(Date.now());response.end('notified');return}
    held.set(request.url,response);response.on('close',()=>{if(held.get(request.url)===response)held.delete(request.url)})
  })
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const GATE_URL=`http://127.0.0.1:${gateway.address().port}`,bundle=join(temporary,'fixture')
  await build({entry:{worker:join(root,'scripts/fixtures/worker-alarms.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const fixture=join(bundle,'worker.js'),configuration={bindings:{CLOCK_NOW:String(NOW),GATE_URL}}
  let worker=await make(fixture,'STORE','AlarmFixture','control',configuration)
  assert.equal((await json(worker,'/activation')).clock.started,true)
  assert.equal((await json(worker,'/validation',post({}))).ok,true)
  for(const info of [null,{retryCount:-1,isRetry:false},{retryCount:0}])assert.equal((await json(worker,'/run',post({info}))).ok,false)
  assert.equal((await state(worker)).clock.runs,0)
  await json(worker,'/register',post({id:'later',at:NOW+5000}));assert.equal((await state(worker)).alarm,NOW+5000)
  await json(worker,'/register',post({id:'earlier',at:NOW+1000}));assert.equal((await state(worker)).alarm,NOW+1000)
  await json(worker,'/cancel',post({id:'earlier'}));assert.equal((await state(worker)).alarm,NOW+5000)
  await json(worker,'/second-handle',post({id:'later',at:NOW+3000}));assert.equal((await state(worker)).alarm,NOW+3000)
  const before=await state(worker)
  assert.equal((await json(worker,'/fault',post({kind:'throw',id:'rolled-back',at:NOW+1000}))).ok,false)
  let snapshot=await state(worker);assert.equal(snapshot.alarm,before.alarm);assert.deepEqual(snapshot.schedules,before.schedules)
  const aborted=await worker.dispatchFetch('http://alarms.example/fault',post({kind:'abort',id:'interrupted',at:NOW+1000}));assert.equal(aborted.ok,false)
  const persisted=await json(worker,'/persisted');assert.notEqual(persisted.boot,before.boot);assert.equal(persisted.alarm,before.alarm);assert.deepEqual(persisted.schedules,before.schedules)
  snapshot=await state(worker);assert.ok(Math.abs(snapshot.alarm-before.alarm)<=1);assert.deepEqual(snapshot.schedules,before.schedules)
  await dispose(worker);worker=await make(fixture,'STORE','AlarmFixture','control',configuration)
  assert.ok(Math.abs((await state(worker)).alarm-before.alarm)<=1)
  await json(worker,'/cancel',post({id:'later'}));assert.equal((await state(worker)).alarm,null)
  await reset(worker)
  await json(worker,'/enqueue',post({id:'no-slide'}));assert.equal((await state(worker)).alarm,NOW+25)
  await json(worker,'/time',post({now:NOW+10}));assert.equal((await state(worker)).alarm,NOW+25)
  assert.equal((await json(worker,'/run',post({coalesce:true,info:{retryCount:2,isRetry:true}}))).ok,true)
  snapshot=await state(worker);assert.equal(snapshot.alarm,null);assert.equal(snapshot.clock.coalesced,1);assert.deepEqual(snapshot.info.at(-1),{retryCount:2,isRetry:true})
  await reset(worker);await json(worker,'/time',post({now:NOW}))
  await json(worker,'/every',post({id:'repeat',at:NOW+100,intervalMs:100}))
  assert.equal((await state(worker)).alarm,NOW+100)
  await json(worker,'/time',post({now:NOW+100}));await json(worker,'/run',post({}))
  assert.equal((await state(worker)).alarm,NOW+200);await json(worker,'/cancel',post({id:'repeat'}));assert.equal((await state(worker)).alarm,null)
  await reset(worker);await json(worker,'/time',post({now:NOW}))
  for(let i=0;i<5;i++)await json(worker,'/register',post({id:'batch-'+i,at:NOW}))
  await json(worker,'/run',post({}));snapshot=await state(worker);assert.equal(snapshot.effects.length,2);assert.ok(snapshot.alarm!==null)
  await json(worker,'/run',post({}));await json(worker,'/run',post({}));snapshot=await state(worker);assert.equal(snapshot.effects.length,5);assert.equal(snapshot.alarm,null)
  await reset(worker);await json(worker,'/enqueue',post({id:'lease'}))
  await json(worker,'/claim',post({leaseMs:200}));assert.equal((await state(worker)).alarm,NOW+200)
  await json(worker,'/time',post({now:NOW+200}));await json(worker,'/run',post({}));snapshot=await state(worker)
  assert.equal(snapshot.jobs[0].attempts,2);assert.equal(snapshot.jobs[0].state,'succeeded');assert.equal(snapshot.alarm,null)
  await reset(worker);await json(worker,'/time',post({now:NOW}));await json(worker,'/enqueue',post({id:'retry'}))
  assert.equal((await json(worker,'/run',post({mode:'retry'}))).ok,false);snapshot=await state(worker)
  assert.equal(snapshot.jobs[0].available_at,NOW+150);assert.equal(snapshot.floor,NOW+200);assert.equal(snapshot.alarm,NOW+200)
  await dispose(worker);worker=await make(fixture,'STORE','AlarmFixture','control',configuration)
  snapshot=await state(worker);assert.equal(snapshot.floor,NOW+200);assert.ok(Math.abs(snapshot.alarm-(NOW+200))<=1)
  await json(worker,'/time',post({now:NOW+200}));await json(worker,'/run',post({}));snapshot=await state(worker)
  assert.equal(snapshot.effects.length,1);assert.equal(snapshot.jobs[0].state,'succeeded');assert.equal(snapshot.floor,0);assert.equal(snapshot.alarm,null)
  await reset(worker);await json(worker,'/enqueue',post({id:'timeout'}))
  const ignored=json(worker,'/run',post({mode:'ignore'}));await waitFor(()=>held.has('/ignore'))
  await waitFor(async()=>(await state(worker)).clock.timedOut===1)
  assert.equal((await state(worker)).clock.active,1)
  let closed=false;const closing=json(worker,'/close').then(value=>{closed=true;return value})
  await waitFor(async()=>(await state(worker)).clock.closing);assert.equal(closed,false);assert.equal((await state(worker)).released,false)
  held.get('/ignore').end('release');assert.equal((await ignored).ok,false);assert.deepEqual(await closing,{released:true,closed:true})
  assert.equal((await json(worker,'/run',post({}))).name,'AlarmClosedError')
  const broken=await make(fixture,'STORE','AlarmFixture','rollback',{bindings:{...configuration.bindings,FAIL_AFTER_CLOCK:true}})
  assert.equal((await json(broken,'/run',post({}))).ok,false,'startup rollback must not wait for its own pending alarm')
  const many=await make(fixture,'STORE','AlarmFixture','many',{bindings:{...configuration.bindings,MANY_QUEUES:true}})
  await json(many,'/enqueue',post({id:'sixty-four-scopes'}));assert.equal((await state(many)).alarm,NOW+25)
  console.log('Native SQL/alarm contract: earliest rearm/cancel, all-handle hooks, no sliding wakeup, rollback after setAlarm/actual Object abort, activation guards, recurring/bounded work, lease/retry wakeups, persisted failure floor, startup rollback and ignored-budget close drain verified.')

  const liveConfig={bindings:{LIVE:true,GATE_URL}}
  let live=await make(fixture,'STORE','AlarmFixture','live',liveConfig)
  await json(live,'/register',post({id:'restart-wakeup',at:Date.now()+1000}))
  const liveBefore=await state(live),notificationCount=notifications.length
  assert.equal((await live.dispatchFetch('http://alarms.example/abort',{method:'POST'})).ok,false)
  // Observe only the gateway: a persisted native alarm must reconstruct the reset Object.
  await waitFor(()=>notifications.length>notificationCount)
  let liveAfter=await waitFor(async()=>{const value=await state(live);return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.notEqual(liveAfter.boot,liveBefore.boot);assert.equal(liveAfter.schedules[0].dispatch_count,1);assert.equal(liveAfter.effects.length,1)
  await reset(live)
  const due=Date.now()+1500;await json(live,'/register',post({id:'cold-restart',at:due}))
  const coldBefore=await state(live),coldNotifications=notifications.length
  await dispose(live);live=await make(fixture,'STORE','AlarmFixture','live',liveConfig)
  // Pinned standalone workerd does not rebuild its alarm timer index without Object activation.
  const activated=await state(live);assert.notEqual(activated.boot,coldBefore.boot);assert.ok(Math.abs(activated.alarm-due)<=1)
  await waitFor(()=>notifications.length>coldNotifications)
  liveAfter=await waitFor(async()=>{const value=await state(live);return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.equal(liveAfter.schedules[0].dispatch_count,1);assert.equal(liveAfter.effects.length,1)
  await reset(live);await json(live,'/mode',post({mode:'abort-after-effect'}))
  const crashCount=notifications.length;await json(live,'/enqueue',post({id:'after-effect',delay:200}))
  await waitFor(()=>notifications.length>=crashCount+2)
  liveAfter=await waitFor(async()=>{const value=await state(live);return value.jobs[0]?.state==='succeeded'?value:undefined})
  assert.equal(liveAfter.jobs[0].attempts,2);assert.equal(liveAfter.effects.length,1)
  await reset(live);const batchNotifications=notifications.length
  await Promise.all(Array.from({length:5},(_,i)=>json(live,'/enqueue',post({id:'native-batch-'+i}))))
  await waitFor(()=>notifications.length>=batchNotifications+3)
  liveAfter=await waitFor(async()=>{const value=await state(live);return value.jobs.filter(job=>job.state==='succeeded').length===5?value:undefined})
  assert.equal(liveAfter.effects.length,5);assert.equal(liveAfter.alarm,null)
  console.log('Actual native alarms: wakeup reconstructs a reset Object without HTTP; cold local-host restart resumes after one startup activation; interruption after committed effect recovers its lease and preserves one idempotent result.')

  const script=join(root,'examples/durable-worker/dist/alarms.js')
  let example=await make(script,'REPORTS','ReportAlarmCoordinator','example')
  const created=await json(example,'/reports',post({numbers:[2,4,6]})),id=created.job.id
  const report=await waitFor(async()=>{const value=await json(example,'/reports/'+id);return value.result?value:undefined})
  assert.equal(report.result.sum,12);assert.equal(report.job.state,'succeeded')
  await json(example,'/report-schedules',post({id:'automatic',numbers:[1,3,5],at:Date.now()+200}))
  const completed=await waitFor(async()=>{const value=(await json(example,'/report-schedules/automatic')).schedule;return value.state==='completed'?value:undefined})
  await waitFor(async()=>(await json(example,'/reports/'+completed.lastJobId)).job.state==='succeeded')
  await json(example,'/report-schedules',post({id:'cancelled',numbers:[99],at:Date.now()+5000}))
  assert.equal((await example.dispatchFetch('http://alarms.example/report-schedules/cancelled',{method:'DELETE'})).status,204)
  assert.equal((await json(example,'/alarm')).nextAlarm,null)
  assert.equal((await example.dispatchFetch('http://alarms.example/_tick',{method:'POST'})).status,404)
  const spans=(await json(example,'/alarm-traces')).spans;assert.ok(spans.length>=2);assert.ok(spans.every(span=>span.name==='alarm.reports'&&span.kind==='consumer'))
  assert.ok(!JSON.stringify(spans).includes(id))
  await dispose(example);example=await make(script,'REPORTS','ReportAlarmCoordinator','example')
  assert.deepEqual(await json(example,'/reports/'+id),report)
  console.log('Compiled alarm reports: immediate jobs and future schedules execute automatically, cancellation clears the last wakeup, control tick is private, consumer traces flush, and results survive restart.')

  const records=[];let output=''
  host=spawn(process.execPath,[join(root,'scripts/serve-alarm-worker.mjs')],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',ALARM_DATA_PATH:join(temporary,'host')},stdio:['ignore','pipe','pipe']})
  createInterface({input:host.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  host.stderr.on('data',chunk=>{output+=chunk});host.on('error',error=>{output+=String(error)})
  hostEnded=new Promise(resolve=>host.once('close',(code,signal)=>resolve({code,signal})))
  const address=(await waitFor(()=>records.find(record=>record.message==='HTTP server listening'))).fields.url
  const response=await fetch(address+'/reports',post({numbers:[7,8]}));assert.equal(response.status,202);const local=(await response.json()).job
  assert.equal((await waitFor(async()=>{const value=await(await fetch(address+'/reports/'+local.id)).json();return value.result?value:undefined})).result.sum,15)
  host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),7000)
  try{assert.equal((await hostEnded).code,0,output)}finally{clearTimeout(timer)}
  assert.ok(records.some(record=>record.message==='Application stopped'));await assert.rejects(fetch(address+'/health',{signal:AbortSignal.timeout(1000)}))
  console.log('Local alarm launcher: automatic report completion over TCP and signal disposal verified with owned temporary storage.')
}finally{
  for(const response of held.values())response.end('cleanup');held.clear()
  if(host&&host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL')
  await hostEnded
  const cleanup=await Promise.allSettled(workers.map(worker=>worker.dispose()))
  try{if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})}finally{await rm(temporary,{recursive:true,force:true})}
  const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason)
  if(errors.length)throw new AggregateError(errors,'Owned alarm host cleanup failed')
}
