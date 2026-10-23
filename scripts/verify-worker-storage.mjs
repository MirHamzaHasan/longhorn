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

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-worker-storage-'))
const workers=[];let gateway,held,host,hostEnded
const waitFor=async predicate=>{const deadline=Date.now()+7000;while(Date.now()<deadline){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Owned storage gate did not settle')}
async function make(scriptPath,namespace,className,extra={}) {
  const worker=new Miniflare({ modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),
    durableObjects:{[namespace]:{className,useSQLite:true}},durableObjectsPersist:join(temporary,namespace),...extra })
  workers.push(worker);await worker.ready;return worker
}
async function dispose(worker) { workers.splice(workers.indexOf(worker),1);await worker.dispose() }
async function json(worker,path,options) {
  const response=await worker.dispatchFetch('http://storage.example'+path,options),body=await response.text()
  assert.ok(response.ok,`${path}: ${response.status} ${body}`);return JSON.parse(body)
}
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
try {
  gateway=createServer((request,response)=>{held=response;response.on('close',()=>{if(held===response)held=undefined})})
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const bundle=join(temporary,'fixture')
  await build({entry:{worker:join(root,'scripts/fixtures/worker-storage.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  let worker=await make(join(bundle,'worker.js'),'STORE','StorageFixture',{bindings:{GATE_URL:`http://127.0.0.1:${gateway.address().port}`}})
  const provider=await json(worker,'/provider')
  assert.equal(provider.ok,true);assert.equal((await json(worker,'/state')).boot,provider.boot)
  assert.equal((await json(worker,'/claims')).ok,true)
  assert.equal((await json(worker,'/dispatch')).ok,true)
  const draining=json(worker,'/drain');await waitFor(()=>held);let finished=false;draining.then(()=>{finished=true})
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(finished,false)
  held.end('release');assert.equal((await draining).ok,true)
  await json(worker,'/prepare-abort')
  const interrupted=await worker.dispatchFetch('http://storage.example/abort-dispatch')
  assert.equal(interrupted.ok,false)
  const afterAbort=await json(worker,'/state')
  assert.notEqual(afterAbort.boot,provider.boot,'native abort must recreate the Object')
  const cursor=afterAbort.schedules.find(row=>row.id==='interrupted')
  assert.equal(cursor.dispatch_count,0);assert.equal(cursor.state,'active');assert.equal(cursor.next_at,0)
  assert.ok(!afterAbort.jobs.some(row=>row.id==='scheduled:interrupted:0'),'interruption must roll back occurrence too')
  await dispose(worker)
  worker=await make(join(bundle,'worker.js'),'STORE','StorageFixture')
  const restarted=await json(worker,'/state')
  assert.notEqual(restarted.boot,afterAbort.boot);assert.deepEqual(restarted.samples,afterAbort.samples)
  assert.deepEqual(restarted.jobs,afterAbort.jobs);assert.deepEqual(restarted.schedules,afterAbort.schedules)
  console.log('Durable SQLite: real SQL/scalars, parameter snapshots, conversion rollback, async transaction/errors, expired executors, bounded admission, close drain, concurrent claims/lease fencing, atomic dispatch/cancel, native Object-abort rollback and workerd restart persistence verified.')

  const script=join(root,'examples/durable-worker/dist/index.js')
  let example=await make(script,'REPORTS','ReportCoordinator')
  assert.deepEqual(await json(example,'/health'),{status:'ok',storage:'durable-object-sqlite'})
  assert.equal((await example.dispatchFetch('http://storage.example/_tick',{method:'POST'})).status,404)
  assert.equal((await example.dispatchFetch('http://storage.example/reports',post({numbers:[]}))).status,400)
  const created=await json(example,'/reports',post({numbers:[2,4,6]})),id=created.job.id
  assert.equal(created.job.state,'pending')
  await json(example,'/report-schedules',post({id:'persisted',numbers:[1,3,5],at:0}))
  await json(example,'/report-schedules',post({id:'cancelled',numbers:[99],at:0}))
  assert.equal((await example.dispatchFetch('http://storage.example/report-schedules/cancelled',{method:'DELETE'})).status,204)
  await dispose(example)
  example=await make(script,'REPORTS','ReportCoordinator')
  assert.equal((await json(example,'/reports/'+id)).job.state,'pending')
  assert.equal((await json(example,'/report-schedules/persisted')).schedule.state,'active')
  const service=await example.getWorker(),event={cron:'* * * * *',scheduledTime:new Date(1790000000000)}
  assert.equal((await service.scheduled(event)).outcome,'ok')
  const report=await json(example,'/reports/'+id)
  assert.equal(report.job.state,'succeeded');assert.deepEqual(report.result,{count:3,sum:12,min:2,max:6})
  const completed=(await json(example,'/report-schedules/persisted')).schedule
  assert.equal(completed.state,'completed');assert.equal(completed.dispatchCount,1)
  assert.deepEqual((await json(example,'/reports/'+completed.lastJobId)).result,{count:3,sum:9,min:1,max:5})
  assert.equal((await service.scheduled(event)).outcome,'ok')
  assert.deepEqual((await json(example,'/report-schedules/persisted')).schedule,completed)
  assert.equal((await json(example,'/report-schedules/cancelled')).schedule.dispatchCount,0)
  const competing=await Promise.all(Array.from({length:6},(_,i)=>json(example,'/reports',post({numbers:[i]}))))
  assert.equal(new Set(competing.map(value=>value.job.id)).size,6)
  assert.equal((await service.scheduled(event)).outcome,'ok')
  for(const value of competing) assert.equal((await json(example,'/reports/'+value.job.id)).job.state,'succeeded')
  await dispose(example)
  example=await make(script,'REPORTS','ReportCoordinator')
  assert.deepEqual(await json(example,'/reports/'+id),report)
  assert.deepEqual((await json(example,'/report-schedules/persisted')).schedule,completed)
  console.log('Compiled durable Worker: HTTP validation/private tick, persisted pending jobs/definitions, scheduled processing after restart, stable replay, cancellation, competing clients and committed results after another restart verified.')

  let output='';const records=[]
  host=spawn(process.execPath,[join(root,'scripts/serve-durable-worker.mjs')],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DURABLE_DATA_PATH:join(temporary,'host')},stdio:['ignore','pipe','pipe']})
  createInterface({input:host.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  host.stderr.on('data',chunk=>{output+=chunk});host.on('error',error=>{output+=String(error)})
  hostEnded=new Promise(resolve=>host.once('close',(code,signal)=>resolve({code,signal})))
  const address=(await waitFor(()=>records.find(record=>record.message==='HTTP server listening'))).fields.url
  const response=await fetch(address+'/reports',post({numbers:[7,8]}));assert.equal(response.status,202)
  const local=(await response.json()).job
  assert.equal((await fetch(address+'/cdn-cgi/mf/scheduled?cron=*+*+*+*+*')).status,200)
  assert.equal((await(await fetch(address+'/reports/'+local.id)).json()).result.sum,15)
  host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),7000)
  try{assert.equal((await hostEnded).code,0,output)}finally{clearTimeout(timer)}
  assert.ok(records.some(record=>record.message==='Application stopped'))
  await assert.rejects(fetch(address+'/health',{signal:AbortSignal.timeout(1000)}))
  console.log('Local durable host: manual real scheduled dispatch, persisted storage path and awaited signal disposal verified using owned temporary data.')
} finally {
  held?.end('cleanup')
  if(host&&host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL')
  await hostEnded
  const cleanup=await Promise.allSettled(workers.map(worker=>worker.dispose()))
  try{if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})}
  finally{await rm(temporary,{recursive:true,force:true})}
  const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason)
  if(errors.length)throw new AggregateError(errors,'Owned storage host cleanup failed')
}
