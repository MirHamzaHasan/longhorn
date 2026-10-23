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
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-worker-queues-'))
const workers=[],held=new Map();let gateway,host,hostEnded
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
const waitFor=async predicate=>{const deadline=Date.now()+8000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Owned queue condition did not settle')}
async function make(scriptPath,extra={}){const worker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),...extra});workers.push(worker);await worker.ready;return worker}
async function dispose(worker){workers.splice(workers.indexOf(worker),1);await worker.dispose()}
const json=async(worker,path,options)=>{const response=await worker.dispatchFetch('http://queues.example'+path,options);assert.ok(response.ok,path+': '+response.status+' '+(!response.ok?await response.text():''));return response.json()}
const state=worker=>json(worker,'/_fixture/state')
const release=path=>{const response=held.get(path);assert.ok(response,path);held.delete(path);response.end('released')}
try{
  gateway=createServer((request,response)=>{held.set(request.url,response);response.on('close',()=>{if(held.get(request.url)===response)held.delete(request.url)})})
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const bundle=join(temporary,'fixture')
  await build({entry:{worker:join(root,'scripts/fixtures/worker-queues.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const worker=await make(join(bundle,'worker.js'),{name:'queue-fixture',compatibilityFlags:['service_binding_extra_handlers'],serviceBindings:{SELF:'queue-fixture'},
    bindings:{NAME:'native',GATE_URL:`http://127.0.0.1:${gateway.address().port}`},queueProducers:{SEND:'broker',DEAD:'dead'},
    queueConsumers:{broker:{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1,deadLetterQueue:'dead'},dead:{maxBatchSize:10,maxBatchTimeout:0,maxRetries:0}}})
  const dispatch=messages=>json(worker,'/_fixture/dispatch',post({messages}))
  const item=(id,mode,more={})=>({id,body:{mode,...more},timestamp:123000,attempts:2})
  const result=await dispatch([item('ack','ack'),item('retry','retry'),item('failed','failure')])
  assert.equal(result.outcome,'exception');assert.deepEqual(result.explicitAcks,['ack']);assert.deepEqual(result.retryMessages,[{msgId:'retry',delaySeconds:3}]);assert.equal(result.retryBatch.retry,false)
  const boundary=await dispatch([item('zero','retry',{delay:0}),item('maximum','retry',{delay:86400})])
  assert.equal(boundary.outcome,'ok');assert.deepEqual(boundary.retryMessages,[{msgId:'zero',delaySeconds:0},{msgId:'maximum',delaySeconds:86400}])
  assert.deepEqual((await state(worker)).seen[0],{id:'ack',time:123000,attempts:2,name:'native',queue:'direct'})
  assert.equal((await json(worker,'/health')).name,'native');assert.equal((await state(worker)).starts,1)
  const pool=dispatch([item('pool-a','hold-a'),item('pool-b','hold-b'),item('pool-c','ack')])
  await waitFor(()=>held.has('/hold-a')&&held.has('/hold-b'))
  assert.equal((await state(worker)).invocations.activeMessages,2)
  assert.ok(!(await state(worker)).seen.some(value=>value.id==='pool-c'))
  release('/hold-a');release('/hold-b');assert.equal((await pool).outcome,'ok')
  const one=dispatch([item('one','hold-one')]),two=dispatch([item('two','hold-two')])
  await waitFor(()=>held.has('/hold-one')&&held.has('/hold-two'))
  assert.equal((await dispatch([item('overflow','ack')])).outcome,'exception')
  assert.equal((await state(worker)).invocations.activeBatches,2)
  release('/hold-one');release('/hold-two');await Promise.all([one,two])
  const flush=dispatch([item('flush','flush')]);await waitFor(()=>held.has('/flush'));assert.equal((await state(worker)).invocations.activeBatches,1)
  release('/flush');assert.equal((await flush).outcome,'ok')
  const cooperative=dispatch([item('abort','cooperative')]);await waitFor(()=>held.has('/cooperative'));assert.equal((await cooperative).outcome,'exception')
  // The pinned broker re-delivers explicit retries; partial failure flags above are checked directly in workerd.
  assert.equal((await worker.dispatchFetch('http://queues.example/_fixture/publish',post({mode:'retry-once'}))).status,204)
  await waitFor(async()=>{const seen=(await state(worker)).seen;return seen.some(value=>value.queue==='broker'&&value.attempts===2)})
  const brokerSeen=(await state(worker)).seen.filter(value=>value.queue==='broker')
  assert.ok(brokerSeen.some(value=>value.attempts===1&&brokerSeen.some(next=>next.id===value.id&&next.attempts===2)))
  await worker.dispatchFetch('http://queues.example/_fixture/publish',post({mode:'poison'}))
  await waitFor(async()=>(await state(worker)).seen.some(value=>value.queue==='dead'))
  const ignored=dispatch([item('ignored','ignore')]);await waitFor(()=>held.has('/ignore'))
  await waitFor(async()=>(await state(worker)).invocations.timedOut>=2)
  assert.equal((await state(worker)).invocations.activeBatches,1);assert.equal((await state(worker)).released,false)
  let closed=false;const closing=json(worker,'/_fixture/close').then(value=>{closed=true;return value})
  await waitFor(async()=>(await state(worker)).invocations.closing);assert.equal(closed,false)
  release('/ignore');const ignoredResult=await ignored;assert.equal(ignoredResult.outcome,'exception');assert.deepEqual(ignoredResult.explicitAcks,[])
  assert.deepEqual(await closing,{released:true,stops:1});assert.equal((await dispatch([item('late','ack')])).outcome,'exception')
  const snapshot=await state(worker);assert.ok(snapshot.spans.every(span=>span.name==='queue.fixture'&&span.kind==='consumer'))
  assert.ok(!JSON.stringify(snapshot.spans).includes('hold-one'))
  console.log('Native workerd: original queue/message metadata, explicit partial ack/retry/error outcomes, bounded message/batch concurrency, actual broker redelivery/dead letter, awaited exporter, cooperative/ignored abort and core/adapter close ownership verified.')

  const script=join(root,'examples/queue-worker/dist/index.js'),configuration={queueProducers:{MESSAGES:'longhorn-messages'},queueConsumers:{'longhorn-messages':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:1}},
    durableObjects:{RECEIPTS:{className:'ReceiptStore',useSQLite:true}},durableObjectsPersist:join(temporary,'receipts')}
  let example=await make(script,configuration)
  assert.equal((await example.dispatchFetch('http://queues.example/messages',post({id:'bad',numbers:[]}))).status,400)
  assert.equal((await example.dispatchFetch('http://queues.example/store',post({}))).status,404)
  assert.equal((await example.dispatchFetch('http://queues.example/messages',post({id:'first',numbers:[2,4,6]}))).status,202)
  const receipt=await waitFor(async()=>{const response=await example.dispatchFetch('http://queues.example/receipts/first');return response.ok?response.json():undefined})
  assert.deepEqual(receipt.receipt,{id:'first',result:{count:3,sum:12,min:2,max:6}})
  await example.dispatchFetch('http://queues.example/messages',post({id:'first',numbers:[99]}))
  await waitFor(async()=>(await json(example,'/queue')).consumer.acked>=2)
  assert.deepEqual(await json(example,'/receipts/first'),receipt)
  const producer=await example.getQueueProducer('MESSAGES');await producer.send({malformed:true},{contentType:'json'})
  await waitFor(async()=>(await json(example,'/queue')).invalid===1)
  const traces=await json(example,'/traces');assert.ok(traces.spans.length>=3)
  assert.ok(traces.spans.every(span=>span.name==='queue.process'&&span.kind==='consumer'))
  assert.ok(!JSON.stringify(traces).includes('first'));assert.ok(!JSON.stringify(traces).includes('numbers'))
  await dispose(example);example=await make(script,configuration)
  assert.deepEqual(await json(example,'/receipts/first'),receipt);assert.equal((await json(example,'/queue')).consumer.acked,0)
  console.log('Compiled queue example: real producer/broker/consumer, HTTP validation, private effect route, idempotent Object SQL receipt, malformed-message policy, trace privacy and persisted receipt across fresh workerd verified.')

  const records=[];let output=''
  host=spawn(process.execPath,[join(root,'scripts/serve-queue-worker.mjs')],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',RECEIPT_DATA_PATH:join(temporary,'host')},stdio:['ignore','pipe','pipe']})
  createInterface({input:host.stdout}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  host.stderr.on('data',chunk=>{output+=chunk});host.on('error',error=>{output+=String(error)})
  hostEnded=new Promise(resolve=>host.once('close',(code,signal)=>resolve({code,signal})))
  const address=(await waitFor(()=>records.find(record=>record.message==='HTTP server listening'))).fields.url
  assert.equal((await fetch(address+'/messages',post({id:'local',numbers:[7,8]}))).status,202)
  assert.equal((await waitFor(async()=>{const response=await fetch(address+'/receipts/local');return response.ok?response.json():undefined})).receipt.result.sum,15)
  host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),7000)
  try{assert.equal((await hostEnded).code,0,output)}finally{clearTimeout(timer)}
  assert.ok(records.some(record=>record.message==='Application stopped'));await assert.rejects(fetch(address+'/queue',{signal:AbortSignal.timeout(1000)}))
  console.log('Local queue host: automatic broker consumption over TCP, completed SQL receipt and signal disposal verified using owned temporary data.')
}finally{
  for(const response of held.values())response.end('cleanup');held.clear()
  if(host&&host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL')
  await hostEnded
  const cleanup=await Promise.allSettled(workers.map(worker=>worker.dispose()))
  try{if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})}finally{await rm(temporary,{recursive:true,force:true})}
  const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason)
  if(errors.length)throw new AggregateError(errors,'Owned queue host cleanup failed')
}
