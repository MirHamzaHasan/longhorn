import assert from'node:assert/strict'
import{spawn,execFile}from'node:child_process'
import{mkdtemp,mkdir,readFile,writeFile,rename,rm,readdir,access}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join,basename,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{promisify}from'node:util'
import{createInterface}from'node:readline'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-d1-project-')),instances=new Set()
function launch(binary,args,cwd,environment={}){
  const child=spawn(binary,args,{cwd,env:{...process.env,HOST:'127.0.0.1',PORT:'0',...environment},stdio:['ignore','pipe','pipe']});let output='';const records=[]
  for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned starter command failed\n'})
  const instance={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>{instances.delete(instance);resolve({code,signal})}))};instances.add(instance);return instance
}
async function stop(instance){
  if(instance.child.exitCode!==null||instance.child.signalCode!==null){await instance.ended;return}
  const groups=new Set()
  if(process.platform!=='win32'){
    const{stdout}=await promisify(execFile)('ps',['-axo','pid=,ppid=,pgid=']),rows=stdout.trim().split('\n').map(row=>row.trim().split(/\s+/).map(Number)),owned=new Set([instance.child.pid]);let size=0
    while(size!==owned.size){size=owned.size;for(const[pid,parent]of rows)if(owned.has(parent))owned.add(pid)}
    for(const[pid,,group]of rows)if(owned.has(pid)&&rows.filter(row=>row[2]===group).every(row=>owned.has(row[0])))groups.add(group)
  }
  instance.child.kill('SIGTERM');let forced=false
  const timer=setTimeout(()=>{forced=true;for(const group of groups)try{process.kill(-group,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}instance.child.kill('SIGKILL')},12000)
  try{await instance.ended;assert.ok(!forced,instance.output())}finally{clearTimeout(timer)}
}
async function command(binary,args,cwd=temporary,environment={}){
  const instance=launch(binary,args,cwd,environment),timer=setTimeout(()=>{void stop(instance)},120000)
  try{const result=await instance.ended;assert.equal(result.code,0,`${args.join(' ')}: ${result.signal??result.code}\n${instance.output()}`);return instance.output()}finally{clearTimeout(timer)}
}
const node=(args,cwd,environment)=>command(process.execPath,args,cwd,environment)
async function waitFor(instance,action){const until=Date.now()+20000;while(Date.now()<until){const value=await action();if(value)return value;if(instance.child.exitCode!==null||instance.child.signalCode!==null)throw new Error(instance.output());await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Starter condition timed out:\n'+instance.output())}
const latest=instance=>instance.records.filter(record=>record.message==='HTTP server listening').at(-1)?.fields.url
const listening=instance=>waitFor(instance,()=>latest(instance))
const post=(title,key)=>({method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify({title}),signal:AbortSignal.timeout(5000)})
async function taskAt(url,id){const response=await fetch(url+'/tasks/'+id,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);return(await response.json()).task}
try{
  const initial=join(temporary,'workspace-created')
  await node([join(root,'cli/dist/bin.js'),'create',initial,'--runtime','workers','--template','d1-tasks'])
  assert.equal(await readFile(join(initial,'src/tasks.ts'),'utf8'),await readFile(join(root,'examples/d1-worker/src/tasks.ts'),'utf8'))
  const cliPack=JSON.parse(await command('pnpm',['pack','--json','--pack-destination',temporary],join(root,'cli'))),creatorPack=JSON.parse(await command('pnpm',['pack','--json','--pack-destination',temporary],join(root,'create-longhorn')))
  assert.ok(cliPack.files.some(file=>file.path==='dist/framework/templates/d1-tasks/template.json'))
  const consumer=join(temporary,'installed cli');await mkdir(consumer)
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,packageManager:'pnpm@12.6.0',dependencies:{'@longhorn/cli':'file:../'+basename(cliPack.filename),'create-longhorn':'file:../'+basename(creatorPack.filename)}}))
  await writeFile(join(consumer,'pnpm-workspace.yaml'),"overrides:\n  '@longhorn/cli': "+JSON.stringify('file:../'+basename(cliPack.filename))+'\n')
  await command('pnpm',['install','--reporter=append-only'],consumer)
  const generated=join(temporary,'packed-created')
  await command('pnpm',['exec','create-longhorn',generated,'--runtime=workers','--template=d1-tasks','--name=persistent-api'],consumer)
  const directory=join(temporary,'relocated D1 application');await rename(generated,directory)
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
  assert.equal(manifest.longhorn.template,'d1-tasks');assert.equal(manifest.packageManager,'pnpm@12.6.0');assert.ok(!JSON.stringify(manifest).includes('workspace:'));assert.ok(!JSON.stringify(manifest).includes(root))
  await command('pnpm',['install','--reporter=append-only'],directory)
  const lock=await readFile(join(directory,'pnpm-lock.yaml'),'utf8');await command('pnpm',['install','--frozen-lockfile','--reporter=append-only'],directory,{CI:'true'});assert.equal(await readFile(join(directory,'pnpm-lock.yaml'),'utf8'),lock)
  for(const action of['typecheck','test','build'])await command('pnpm',['exec','longhorn',action,'--cwd',directory],consumer)
  await node(['tests/storage.mjs'],directory)
  console.log('D1 starter distribution: workspace/packed binaries, actual source snapshot, relocated fresh/frozen install, types/tests/browser build and shipped native storage/restart gate verified.')
  const cli=join(consumer,'node_modules/@longhorn/cli/dist/bin.js'),start=(environment={})=>launch(process.execPath,[cli,'start','--cwd',directory],consumer,{D1_CREATE_LIMIT_ENABLED:'false',...environment})
  let host=start(),url=await listening(host)
  assert.equal((await fetch(url+'/deploy',{method:'POST'})).status,404)
  let response=await fetch(url+'/tasks',post('retained generated task','native-key'));assert.equal(response.status,201);const saved=await response.json()
  response=await fetch(url+'/tasks/'+saved.task.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,completed:true})});assert.equal(response.status,200)
  await stop(host);assert.ok(host.records.some(row=>row.message==='Application stopped'),host.output())
  host=start();url=await listening(host);assert.equal((await taskAt(url,saved.task.id)).completed,true)
  response=await fetch(url+'/tasks',post('retained generated task','native-key'));assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await response.json(),saved)
  await stop(host)
  console.log('Installed D1 host: private schema authority removed, actual HTTP task/activity/replay data retained across separate CLI host processes and graceful shutdown verified.')
  const development=launch(process.execPath,[cli,'dev','--cwd',directory],consumer)
  url=await listening(development)
  const sourcePath=join(directory,'src/app.ts'),source=await readFile(sourcePath,'utf8');assert.ok(source.includes("status:'ok'"))
  const starts=development.records.filter(row=>row.message==='HTTP server listening').length
  await writeFile(sourcePath,source+'\ninvalid syntax !!!\n')
  await waitFor(development,()=>development.records.some(row=>row.message==='D1 development build failed'))
  assert.equal((await(await fetch(url+'/health')).json()).status,'ok');assert.equal(development.records.filter(row=>row.message==='HTTP server listening').length,starts)
  await writeFile(sourcePath,source.replace("status:'ok'","status:'edited'"))
  await waitFor(development,async()=>{if(development.records.filter(row=>row.message==='HTTP server listening').length<=starts)return false;try{return(await(await fetch(latest(development)+'/health',{signal:AbortSignal.timeout(500)})).json()).status==='edited'}catch{return false}})
  url=latest(development);assert.equal((await taskAt(url,saved.task.id)).completed,true)
  response=await fetch(url+'/tasks',post('retained generated task','native-key'));assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await response.json(),saved)
  await stop(development);assert.ok(development.records.some(row=>row.message==='Development stopped'),development.output())
  await assert.rejects(fetch(url+'/health',{signal:AbortSignal.timeout(1000)}))
  await writeFile(sourcePath,source)
  console.log('Installed D1 development: failed compilation retains the previous host, corrected source reloads through owned process replacement, data/replay survive, and CLI shutdown releases watcher/native listener.')
  const invalidPath=join(temporary,'invalid-config'),invalid=launch(process.execPath,['serve.mjs'],directory,{D1_DATA_PATH:invalidPath,D1_REQUEST_RETENTION_MS:'0'})
  assert.equal((await invalid.ended).code,1);await assert.rejects(access(invalidPath))
  const schemaPath=join(directory,'src/schema.ts'),schema=await readFile(schemaPath,'utf8');assert.ok(schema.includes('CREATE TABLE d1_tasks('))
  await writeFile(schemaPath,schema.replace('CREATE TABLE d1_tasks(','CREATE TABLE d1_tasks( '))
  const drift=launch(process.execPath,[cli,'dev','--cwd',directory],consumer)
  const result=await Promise.race([drift.ended,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Schema drift host did not terminate:\n'+drift.output())),20000);timer.unref()})])
  assert.equal(result.code,1);assert.ok(!drift.records.some(row=>row.message==='HTTP server listening'));assert.ok(drift.records.some(row=>row.message==='Development stopped'),drift.output())
  await writeFile(schemaPath,schema);await command('pnpm',['run','build'],directory)
  host=start();url=await listening(host);assert.equal((await taskAt(url,saved.task.id)).completed,true);await stop(host)
  assert.ok(!(await readdir(temporary)).some(name=>name.startsWith('.longhorn-create-')))
  console.log('Installed D1 failure boundaries: invalid configuration creates no data directory; changed applied schema rejects readiness and closes development, while restoring source preserves retained data.')
  const budget={D1_CREATE_LIMIT_ENABLED:'true',D1_CREATE_LIMIT_REQUESTS:'2',D1_CREATE_LIMIT_WINDOW_MS:'5000'}
  let limited=start(budget),limitedUrl=await listening(limited)
  let limitedReplay=await fetch(limitedUrl+'/tasks',post('retained generated task','native-key'));assert.equal(limitedReplay.status,201);assert.equal(limitedReplay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await limitedReplay.json(),saved);await stop(limited)
  limited=start(budget);limitedUrl=await listening(limited);limitedReplay=await fetch(limitedUrl+'/tasks',post('retained generated task','native-key'));assert.equal(limitedReplay.status,201);assert.equal(limitedReplay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await limitedReplay.json(),saved)
  const blocked=await fetch(limitedUrl+'/tasks',post('must not create','blocked-key'));assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>=1);assert.equal((await taskAt(limitedUrl,saved.task.id)).completed,true)
  await waitFor(limited,async()=>{const response=await fetch(limitedUrl+'/tasks',post('retained generated task','native-key'));if(response.status===429)return false;assert.equal(response.status,201);assert.equal(response.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await response.json(),saved);return true});await stop(limited)
  await mkdir(join(root,'.artifacts'),{recursive:true});await writeFile(join(root,'.artifacts/d1-rate-limit-project-proof.json'),JSON.stringify({installedCli:true,sourceSnapshot:true,shippedNativeStorageProof:true,separateHostBudgetRetained:true,countedReplay:true,retryAfter429:true,readsUnaffected:true,expiryRetainsOriginalReplay:true,noPublicDeployAuthority:true},null,2)+'\n')
  console.log('Installed D1 limit profile: real CLI environment forwarding, retained budget across separate hosts, counted stable replay, 429/read availability and native expiry recovery with the original result verified.')
}finally{await Promise.all([...instances].map(stop));await rm(temporary,{recursive:true,force:true})}
