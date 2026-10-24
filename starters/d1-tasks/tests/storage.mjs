import assert from'node:assert/strict'
import{mkdtemp,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{fileURLToPath}from'node:url'
import{Miniflare,Log,LogLevel}from'miniflare'
const directory=await mkdtemp(join(tmpdir(),'longhorn-d1-starter-'))
let worker
async function make(){
  const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))])),common={modules:true,compatibilityDate:'2025-07-18',d1Databases:{DB:'longhorn-d1-tasks'}}
  const instance=new Miniflare({host:'127.0.0.1',port:0,cf:false,d1Persist:directory,log:new Log(LogLevel.NONE),workers:[
    ...['first','second'].map(name=>({...common,name,scriptPath:fileURLToPath(new URL('../dist/index.js',import.meta.url))})),
    {...common,name:'schema',scriptPath:fileURLToPath(new URL('../dist/deploy.js',import.meta.url))},
  ]})
  for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
  try{await instance.ready;return instance}catch(error){await instance.dispose();throw error}
}
const post=(title,key)=>({method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify({title})})
async function json(service,path,options){const response=await service.fetch('http://tasks'+path,options);assert.ok(response.ok,`${path}: ${response.status}`);return response.json()}
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{void worker?.dispose()})
try{
  worker=await make();let first=await worker.getWorker('first'),second=await worker.getWorker('second'),schema=await worker.getWorker('schema')
  assert.equal((await first.fetch('http://tasks/health')).status,503)
  assert.deepEqual((await json(schema,'/deploy',{method:'POST'})).applied,['d1-tasks/001','d1-tasks/002','longhorn_batch_idempotency/001_requests'])
  await json(first,'/health');await json(second,'/health')
  assert.equal((await first.fetch('http://tasks/deploy',{method:'POST'})).status,404)
  const responses=await Promise.all(Array.from({length:6},(_,index)=>(index%2?first:second).fetch('http://tasks/tasks',post(' retained task ','one-key'))))
  assert.ok(responses.every(value=>value.status===201));assert.equal(responses.filter(value=>value.headers.get('Idempotency-Replayed')==='false').length,1)
  const tasks=await Promise.all(responses.map(value=>value.json())),saved=tasks[0].task
  assert.ok(tasks.every(value=>JSON.stringify(value)===JSON.stringify(tasks[0])))
  assert.equal((await json(first,'/tasks/'+saved.id+'/activity')).activity.length,1)
  assert.equal((await first.fetch('http://tasks/tasks',post('different','one-key'))).status,409)
  const changed=await first.fetch('http://tasks/tasks/'+saved.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,completed:true})});assert.equal(changed.status,200)
  assert.equal((await second.fetch('http://tasks/tasks/'+saved.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,title:'stale'})})).status,409)
  const created=[];for(let index=0;index<12;index++)created.push((await json(first,'/tasks',post('page '+index))).task)
  const listed=[];let after='0'
  do{const page=await json(first,'/tasks?limit=2&after='+after);listed.push(...page.tasks);after=page.nextCursor}while(after)
  assert.deepEqual(listed.map(task=>task.id),[saved.id,...created.map(task=>task.id)])
  await worker.dispose();worker=await make();first=await worker.getWorker('first')
  const replay=await first.fetch('http://tasks/tasks',post('retained task','one-key'));assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),tasks[0])
  assert.equal((await json(first,'/tasks/'+saved.id)).task.completed,true)
  assert.deepEqual((await json(first,'/tasks/'+saved.id+'/activity')).activity.map(row=>row.kind),['created','updated'])
  console.log('Installed D1 starter: private schema deployment, cross-worker replay, revision conflicts, numeric pages and retained task/activity/response across workerd restart verified.')
}finally{await worker?.dispose();await rm(directory,{recursive:true,force:true})}
