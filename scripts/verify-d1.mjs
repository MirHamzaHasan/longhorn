import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createInterface} from 'node:readline'
import {build} from 'tsup'
import {Miniflare,Log,LogLevel} from 'miniflare'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-d1-')),instances=new Set()
let runtime,interrupted=false
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;for(const instance of instances)instance.child.kill('SIGTERM');void runtime?.dispose()})
const waitFor=async action=>{const end=Date.now()+15000;while(Date.now()<end){if(interrupted)throw new Error('D1 verification interrupted');const value=await action();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('D1 verification condition timed out')}
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
function launch(directory,extra={}){
  const child=spawn(process.execPath,['scripts/serve-d1-worker.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',D1_DATA_PATH:directory,D1_MAX_PENDING:'6',...extra},stdio:['ignore','pipe','pipe']});let output='';const records=[]
  for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned D1 host failed'})
  const instance={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>{instances.delete(instance);resolve({code,signal})}))};instances.add(instance);return instance
}
async function stop(instance){if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),8000);try{const result=await instance.ended;assert.equal(result.code,0,instance.output())}finally{clearTimeout(timer)}}
const listening=instance=>waitFor(()=>{if(instance.child.exitCode!==null)throw new Error(instance.output());return instance.records.find(row=>row.message==='HTTP server listening')?.fields.url})
async function make(fixture){
  const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))]))
  const worker=new Miniflare({host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',d1Persist:join(temporary,'retained'),log:new Log(LogLevel.NONE),workers:[
    {name:'fixture',modules:true,compatibilityDate:'2025-07-18',modulesRoot:dirname(fixture),scriptPath:fixture,d1Databases:{DB:'native-contract-d1',TASKS:'longhorn-d1-tasks'}},
    ...['tasks-a','tasks-b'].map(name=>({name,modules:true,compatibilityDate:'2025-07-18',scriptPath:join(root,'examples/d1-worker/dist/index.js'),d1Databases:{DB:'longhorn-d1-tasks'}})),
    {name:'schema',modules:true,compatibilityDate:'2025-07-18',scriptPath:join(root,'examples/d1-worker/dist/deploy.js'),d1Databases:{DB:'longhorn-d1-tasks'}},
  ]})
  for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
  try{await worker.ready;return worker}catch(error){await worker.dispose();throw error}
}
async function json(service,path,options){const response=await service.fetch('http://owned'+path,options),body=await response.text();assert.ok(response.ok,`${path}: ${response.status} ${body}`);return JSON.parse(body)}
try{
  const bundle=join(temporary,'fixture');await build({entry:{worker:join(root,'scripts/fixtures/d1-storage.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const fixturePath=join(bundle,'worker.js');runtime=await make(fixturePath)
  let fixture=await runtime.getWorker('fixture'),first=await runtime.getWorker('tasks-a'),second=await runtime.getWorker('tasks-b'),schema=await runtime.getWorker('schema')
  assert.equal((await json(fixture,'/provider')).verified,true)
  assert.equal((await json(fixture,'/migrations')).verified,true)
  assert.equal((await json(fixture,'/drain')).verified,true)
  console.log('D1 native provider: real binding scalars/blobs and snapshots, atomic constraint rollback, unsafe numeric rejection, exact int64 text, post-commit decoding ambiguity, trigger boundaries, count admission and actual accepted-work close drain verified.')
  console.log('D1 schema: whole-suffix DDL/history rollback, immutable checksums, guarded concurrent upgrade with one winner, explicit idempotent rerun and read-only verification proved on actual D1 storage.')
  assert.equal((await first.fetch('http://tasks/health')).status,503)
  const sql=async(statement,args=[],database='tasks')=>(await json(fixture,'/sql',post({sql:statement,args,database}))).results
  assert.equal((await sql("SELECT name FROM sqlite_master WHERE name='longhorn_batch_migrations'")).length,0)
  assert.deepEqual((await json(schema,'/deploy',post({}))).applied,['d1-tasks/001','d1-tasks/002'])
  assert.deepEqual((await json(schema,'/deploy',post({}))).applied,[])
  assert.equal((await json(first,'/health')).storage,'d1')
  const hiddenDeploy=await first.fetch('http://tasks/deploy',post({}));assert.equal(hiddenDeploy.status,404,await hiddenDeploy.text())
  assert.equal((await first.fetch('http://tasks/tasks',post({title:' '}))).status,400)
  assert.equal((await first.fetch('http://tasks/tasks?after=9223372036854775808')).status,400)
  assert.equal((await first.fetch('http://tasks/tasks?after=1.0')).status,400)
  assert.equal((await first.fetch('http://tasks/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400)
  assert.equal((await first.fetch('http://tasks/tasks',post({title:'x'.repeat(17000)}))).status,413)
  let response=await first.fetch('http://tasks/tasks',post({title:'  persisted D1 task  '}));assert.equal(response.status,201);const created=(await response.json()).task
  assert.equal(created.title,'persisted D1 task');assert.equal(created.revision,1)
  const edits=await Promise.all(Array.from({length:8},(_,index)=>(index%2?first:second).fetch('http://tasks/tasks/'+created.id,{...post({revision:1,completed:true}),method:'PATCH'})))
  assert.equal(edits.filter(value=>value.status===200).length,1);assert.equal(edits.filter(value=>value.status===409).length,7)
  const changed=(await json(first,'/tasks/'+created.id)).task;assert.equal(changed.revision,2);assert.equal(changed.completed,true)
  assert.equal((await json(first,'/tasks/'+created.id+'/activity')).activity.length,2)
  response=await second.fetch('http://tasks/tasks/'+created.id,{...post({revision:1}),method:'DELETE'});assert.equal(response.status,409)
  await sql("CREATE TRIGGER reject_activity BEFORE INSERT ON d1_task_activity WHEN NEW.kind='created' BEGIN SELECT RAISE(ABORT,'private activity failure'); END")
  response=await first.fetch('http://tasks/tasks',post({title:'must roll back with activity'}));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private'))
  assert.equal((await sql("SELECT COUNT(*) AS total FROM d1_tasks WHERE title='must roll back with activity'"))[0].total,0);await sql('DROP TRIGGER reject_activity')
  const more=await Promise.all(Array.from({length:5},(_,index)=>json(index%2?first:second,'/tasks',post({title:'page '+index}))))
  let after='0';const listed=[]
  do{const page=await json(first,'/tasks?limit=2&after='+after);listed.push(...page.tasks);after=page.nextCursor}while(after)
  assert.equal(listed.length,6);assert.equal(new Set(listed.map(task=>task.id)).size,6)
  response=await second.fetch('http://tasks/tasks/'+created.id,{...post({revision:2}),method:'DELETE'});assert.equal(response.status,204)
  assert.equal((await first.fetch('http://tasks/tasks/'+created.id)).status,404)
  assert.deepEqual((await json(first,'/tasks/'+created.id+'/activity')).activity.map(item=>item.kind),['created','updated','deleted'])
  const at=new Date().toISOString(),wideIds=[crypto.randomUUID(),crypto.randomUUID()]
  for(let index=0;index<2;index++){
    const position=String(9007199254740993n+BigInt(index)),id=wideIds[index]
    await sql('INSERT INTO d1_tasks(position,id,title,completed,revision,created_at,updated_at,mutation) VALUES(?,?,?,0,1,?,?,?)',[position,id,'wide cursor '+index,at,at,crypto.randomUUID()])
    await sql("INSERT INTO d1_task_activity(position,task_id,revision,kind,at,mutation) VALUES(?,?,1,'created',?,?)",[position,id,at,crypto.randomUUID()])
  }
  const wide=await json(first,'/tasks?after=9007199254740992&limit=1');assert.equal(wide.tasks[0].id,wideIds[0]);assert.equal(wide.nextCursor,'9007199254740993')
  assert.equal((await json(second,'/tasks?after='+wide.nextCursor+'&limit=1')).tasks[0].id,wideIds[1])
  assert.deepEqual((await json(first,'/activity?after=9007199254740992')).activity.map(item=>item.position),['9007199254740993','9007199254740994'])
  const state=await json(fixture,'/state'),activity=await json(first,'/activity')
  await runtime.dispose();runtime=await make(fixturePath);fixture=await runtime.getWorker('fixture');first=await runtime.getWorker('tasks-a')
  const restarted=await json(fixture,'/state');assert.notEqual(restarted.boot,state.boot);assert.deepEqual(restarted.samples,state.samples)
  assert.deepEqual(await json(first,'/activity'),activity)
  assert.equal((await json(first,'/tasks/'+more[0].task.id)).task.title,more[0].task.title)
  await runtime.dispose();runtime=undefined
  console.log('D1 task HTTP: deployment-only schema, DI/lifecycle readiness, validated CRUD, one-winner cross-worker revision edits, atomic activity failure rollback, bounded exact-int64 cursor pages and retained tasks/activity across actual workerd process restart verified.')
  let host=launch(join(temporary,'retained')),url=await listening(host)
  assert.equal((await fetch(url+'/health')).status,200)
  assert.equal((await fetch(url+'/deploy',post({}))).status,404)
  const throughHost=await fetch(url+'/tasks',post({title:'native host task'}));assert.equal(throughHost.status,201);const hostTask=(await throughHost.json()).task
  await stop(host);host=launch(join(temporary,'retained'));url=await listening(host);assert.equal((await(await fetch(url+'/tasks/'+hostTask.id)).json()).task.title,'native host task');await stop(host)
  const invalidDirectory=join(temporary,'invalid-config'),invalid=launch(invalidDirectory,{D1_MAX_PENDING:'0'});assert.equal((await invalid.ended).code,1);await assert.rejects(access(invalidDirectory))
  const interruptedHost=launch(join(temporary,'interrupted'))
  await waitFor(()=>interruptedHost.records.some(row=>row.message==='D1 development host starting'));await stop(interruptedHost);assert.ok(!interruptedHost.records.some(row=>row.message==='HTTP server listening'))
  console.log('D1 development host: trusted schema worker removed before readiness, real retained HTTP tasks across restart, early configuration rejection and signal-driven startup cleanup verified.')
}finally{
  for(const instance of instances){if(instance.child.exitCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),8000);try{await instance.ended}finally{clearTimeout(timer)}}
  await runtime?.dispose();await rm(temporary,{recursive:true,force:true})
}
