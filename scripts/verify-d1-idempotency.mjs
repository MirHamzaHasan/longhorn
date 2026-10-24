import assert from'node:assert/strict'
import{mkdtemp,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{createServer}from'node:http'
import{once}from'node:events'
import{build}from'tsup'
import{Miniflare,Log,LogLevel}from'miniflare'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-d1-requests-'))
let worker,gateway
const sockets=new Set()
const post=(title,key)=>({method:'POST',headers:{'Content-Type':'application/json',...(key===undefined?{}:{'Idempotency-Key':key})},body:JSON.stringify({title})})
const jsonPost=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
async function json(service,path,options){const response=await service.fetch('http://owned'+path,options),body=await response.text();assert.ok(response.ok,`${path}: ${response.status} ${body}`);return JSON.parse(body)}
async function make(fixture){
  const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))]))
  const common={modules:true,compatibilityDate:'2025-07-18'},instance=new Miniflare({host:'127.0.0.1',port:0,cf:false,d1Persist:join(temporary,'retained'),log:new Log(LogLevel.NONE),workers:[
    ...['tasks-a','tasks-b','tasks-short'].map(name=>({...common,name,scriptPath:join(root,'examples/d1-worker/dist/index.js'),d1Databases:{DB:'longhorn-d1-tasks'},bindings:{D1_MAX_PENDING:'6',D1_REQUEST_RETENTION_MS:name==='tasks-short'?'40':'86400000'}})),
    {...common,name:'fixture',modulesRoot:dirname(fixture),scriptPath:fixture,d1Databases:{DB:'native-idempotency',TASKS:'longhorn-d1-tasks'}},
    {...common,name:'schema',scriptPath:join(root,'examples/d1-worker/dist/deploy.js'),d1Databases:{DB:'longhorn-d1-tasks'}},
  ]})
  for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
  try{await instance.ready;return instance}catch(error){await instance.dispose();throw error}
}
async function closeGateway(){if(gateway){gateway.close();for(const socket of sockets)socket.destroy();await once(gateway,'close');gateway=undefined}}
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{void closeGateway();void worker?.dispose()})
try{
  await build({entry:{worker:join(root,'scripts/fixtures/d1-idempotency.mjs')},outDir:join(temporary,'bundle'),bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const fixturePath=join(temporary,'bundle/worker.js');worker=await make(fixturePath)
  let first=await worker.getWorker('tasks-a'),second=await worker.getWorker('tasks-b'),fixture=await worker.getWorker('fixture'),schema=await worker.getWorker('schema')
  const sql=async(statement,args=[])=>(await json(fixture,'/sql',jsonPost({sql:statement,args}))).rows
  assert.equal((await first.fetch('http://tasks/health')).status,503)
  const legacy=await json(fixture,'/legacy',jsonPost({}))
  assert.equal((await first.fetch('http://tasks/health')).status,503)
  assert.deepEqual((await json(schema,'/deploy',jsonPost({}))).applied,['longhorn_batch_idempotency/001_requests','longhorn_batch_rate_limit/001_buckets'])
  assert.equal((await json(first,'/tasks/'+legacy.id)).task.title,'legacy retained task')
  assert.equal((await json(first,'/tasks/'+legacy.id+'/activity')).activity.length,1)
  assert.deepEqual((await json(schema,'/deploy',jsonPost({}))).applied,[])
  assert.equal((await json(fixture,'/contract')).verified,true)
  console.log('D1 request protocol: native ledger/business rollback, canonical JSON replay/conflict, scope isolation, lost binding acknowledgement and post-commit decoder recovery, expired-generation failure restoration/races and bounded cleanup without deleting effects verified.')
  for(const key of['','bad key','x'.repeat(201)])assert.equal((await first.fetch('http://tasks/tasks',post('invalid key',key))).status,400)
  assert.equal((await sql('SELECT COUNT(*) AS count FROM longhorn_batch_idempotency_requests'))[0].count,0)
  await json(second,'/health')
  const duplicates=await Promise.all(Array.from({length:6},(_,index)=>(index%2?first:second).fetch('http://tasks/tasks',post(index%2?' same task ':'same task','concurrent-key'))))
  assert.ok(duplicates.every(response=>response.status===201))
  assert.equal(duplicates.filter(response=>response.headers.get('Idempotency-Replayed')==='false').length,1)
  assert.equal(duplicates.filter(response=>response.headers.get('Idempotency-Replayed')==='true').length,5)
  assert.equal(new Set(duplicates.map(response=>response.headers.get('Idempotency-Expires-At'))).size,1)
  const bodies=await Promise.all(duplicates.map(response=>response.json())),created=bodies[0].task
  assert.ok(bodies.every(body=>JSON.stringify(body)===JSON.stringify(bodies[0])))
  assert.equal((await sql('SELECT COUNT(*) AS count FROM d1_tasks WHERE id=?',[created.id]))[0].count,1)
  assert.equal((await sql('SELECT COUNT(*) AS count FROM d1_task_activity WHERE task_id=?',[created.id]))[0].count,1)
  const conflict=await first.fetch('http://tasks/tasks',post('different private title','concurrent-key'));assert.equal(conflict.status,409);assert.ok(!(await conflict.text()).includes('private title'))
  let response=await first.fetch('http://tasks/tasks/'+created.id,{...jsonPost({revision:1,completed:true}),method:'PATCH'});assert.equal(response.status,200)
  const historical=await first.fetch('http://tasks/tasks',post('same task','concurrent-key'));assert.equal(historical.status,201);assert.deepEqual(await historical.json(),bodies[0])
  assert.equal((await json(first,'/tasks/'+created.id)).task.completed,true)
  await sql("CREATE TRIGGER reject_keyed_activity BEFORE INSERT ON d1_task_activity WHEN NEW.kind='created' BEGIN SELECT RAISE(ABORT,'private storage failure'); END")
  response=await first.fetch('http://tasks/tasks',post('rolled back task','retry-failure'));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private'))
  assert.equal((await sql("SELECT COUNT(*) AS count FROM d1_tasks WHERE title='rolled back task'"))[0].count,0)
  assert.equal((await sql("SELECT COUNT(*) AS count FROM longhorn_batch_idempotency_requests WHERE request_key='retry-failure'"))[0].count,0)
  await sql('DROP TRIGGER reject_keyed_activity');response=await first.fetch('http://tasks/tasks',post('rolled back task','retry-failure'));assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'false')
  const unkeyed=await Promise.all([json(first,'/tasks',post('no key')),json(first,'/tasks',post('no key'))]);assert.notEqual(unkeyed[0].task.id,unkeyed[1].task.id)
  const short=await worker.getWorker('tasks-short'),shortFirst=await short.fetch('http://tasks/tasks',post('short retention','short-key')),shortTask=(await shortFirst.json()).task,expires=Number(shortFirst.headers.get('Idempotency-Expires-At'))
  assert.equal(shortFirst.status,201);assert.ok(Number.isSafeInteger(expires)&&expires>0)
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+5)))
  response=await short.fetch('http://tasks/tasks',post('new generation after expiry','short-key'));assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'false');assert.notEqual((await response.json()).task.id,shortTask.id)
  console.log('D1 HTTP/upgrade: old task/activity schema preserved, private ledger deployment/read-only recovery, one winner across six cross-worker requests, original response after live edits, generic conflicts, failed activity rollback and explicit retry, optional keys and configured expiry verified.')
  const upstream=String(await worker.ready),key='dropped-http-response'
  let received,calls=0
  gateway=createServer(async(request,response)=>{
    try{
      calls++;const chunks=[];for await(const chunk of request)chunks.push(chunk)
      const result=await fetch(new URL('/tasks',upstream),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':request.headers['idempotency-key']},body:Buffer.concat(chunks),signal:AbortSignal.timeout(5000)})
      const body=Buffer.from(await result.arrayBuffer())
      if(calls===1){received={status:result.status,body:JSON.parse(body.toString()),location:result.headers.get('Location')};response.destroy();return}
      // Fetch has decoded the body; do not forward upstream compression/length framing.
      const headers={}
      for(const name of['Content-Type','Cache-Control','Location','Idempotency-Replayed','Idempotency-Expires-At']){const value=result.headers.get(name);if(value!==null)headers[name]=value}
      response.writeHead(result.status,headers);response.end(body)
    }catch{response.destroy()}
  })
  gateway.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
  const address='http://127.0.0.1:'+gateway.address().port
  await assert.rejects(fetch(address+'/tasks',{...post('recover actual lost HTTP',key),signal:AbortSignal.timeout(5000)}))
  assert.equal(calls,1);assert.equal(received.status,201)
  response=await fetch(address+'/tasks',post('recover actual lost HTTP',key));assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.equal(response.headers.get('Location'),received.location);assert.deepEqual(await response.json(),received.body)
  const retained=received.body.task;assert.equal((await sql('SELECT COUNT(*) AS count FROM d1_task_activity WHERE task_id=?',[retained.id]))[0].count,1)
  await closeGateway();await worker.dispose();worker=await make(fixturePath);first=await worker.getWorker('tasks-a');fixture=await worker.getWorker('fixture')
  response=await first.fetch('http://tasks/tasks',post('recover actual lost HTTP',key));assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await response.json(),received.body)
  assert.equal((await sql('SELECT COUNT(*) AS count FROM d1_task_activity WHERE task_id=?',[retained.id]))[0].count,1)
  response=await first.fetch('http://tasks/tasks/'+retained.id,{...jsonPost({revision:1}),method:'DELETE'});assert.equal(response.status,204)
  response=await first.fetch('http://tasks/tasks',post('recover actual lost HTTP',key));assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await response.json(),received.body)
  assert.equal((await first.fetch('http://tasks/tasks/'+retained.id)).status,404)
  assert.deepEqual((await json(first,'/tasks/'+retained.id+'/activity')).activity.map(row=>row.kind),['created','deleted'])
  console.log('D1 transport/restart: an actual downstream socket loses the committed 201 reply; same-key HTTP retry recovers the exact response/Location with one task/activity. Retained ledger replays after a new workerd process and after task deletion without recreating effects.')
}finally{await closeGateway();await worker?.dispose();await rm(temporary,{recursive:true,force:true})}
