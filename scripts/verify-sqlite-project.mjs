import assert from'node:assert/strict'
import{spawn,execFile}from'node:child_process'
import{mkdtemp,mkdir,readFile,writeFile,rename,rm,readdir,access}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join,basename,dirname}from'node:path'
import{fileURLToPath}from'node:url'
import{promisify}from'node:util'
import{createInterface}from'node:readline'
import{createRequire}from'node:module'
const runtime=process.argv[2]??'node'
assert.ok(['node','bun'].includes(runtime),'Expected node or bun SQLite project profile')
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-'+runtime+'-sqlite-project-')),instances=new Set()
function launch(binary,args,cwd,environment={}){
  const ownedEnvironment={...process.env,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',CACHE_TTL_MS:'250',NODE_ENV:'development'}
  for(const key of ['APP_NAME','DATABASE_PATH'])delete ownedEnvironment[key]
  Object.assign(ownedEnvironment,environment)
  const child=spawn(binary,args,{cwd,env:ownedEnvironment,stdio:['ignore','pipe','pipe']});let output='';const records=[]
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
  await node([join(root,'cli/dist/bin.js'),'create',initial,'--runtime',runtime,'--template','sqlite-tasks'])
  for(const name of [...(runtime==='node'?['index.ts']:[]),'app.ts','sqlite-tasks.ts','task-cache.ts','task-events.ts'])assert.equal(await readFile(join(initial,'src',name),'utf8'),await readFile(join(root,'examples/basic/src',name),'utf8'))
  if(runtime==='bun')for(const name of['index.ts','storage.ts'])assert.equal(await readFile(join(initial,'src',name),'utf8'),(await readFile(join(root,'examples/bun-sqlite/src',name),'utf8')).replace(/'\.\.\/\.\.\/basic\/src\/([a-z-]+\.js)'/g,"'./$1'"))
  await assert.rejects(access(join(initial,'src/redis-index.ts')))
  const cliPack=JSON.parse(await command('pnpm',['pack','--json','--pack-destination',temporary],join(root,'cli'))),creatorPack=JSON.parse(await command('pnpm',['pack','--json','--pack-destination',temporary],join(root,'create-longhorn')))
  assert.ok(cliPack.files.some(file=>file.path==='dist/framework/templates/'+(runtime==='bun'?'bun-sqlite-tasks':'sqlite-tasks')+'/template.json'))
  const consumer=join(temporary,'installed cli');await mkdir(consumer)
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,packageManager:'pnpm@12.6.0',dependencies:{'@longhorn/cli':'file:../'+basename(cliPack.filename),'create-longhorn':'file:../'+basename(creatorPack.filename)}}))
  await writeFile(join(consumer,'pnpm-workspace.yaml'),"overrides:\n  '@longhorn/cli': "+JSON.stringify('file:../'+basename(cliPack.filename))+'\n')
  await command('pnpm',['install','--reporter=append-only'],consumer)
  const generated=join(temporary,'packed-created')
  await command('pnpm',['exec','create-longhorn',generated,'--runtime='+runtime,'--template=sqlite-tasks','--name=local-tasks','--install'],consumer)
  const directory=join(temporary,'relocated SQLite application');await rename(generated,directory)
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
  assert.equal(manifest.longhorn.template,'sqlite-tasks');assert.equal(manifest.longhorn.runtime,runtime);assert.ok(!JSON.stringify(manifest).includes('workspace:'));assert.ok(!JSON.stringify(manifest).includes(root))
  if(runtime==='bun'){
    const packages=await readdir(join(directory,'.longhorn/framework'))
    assert.ok(packages.includes('bun'));assert.ok(!packages.includes('node'));assert.ok(!packages.includes('workers'))
    for(const entry of await readdir(join(directory,'src')))assert.ok(!(await readFile(join(directory,'src',entry),'utf8')).includes('@longhorn/node'))
  }
  const lock=await readFile(join(directory,'pnpm-lock.yaml'),'utf8');await command('pnpm',['install','--frozen-lockfile','--reporter=append-only'],directory,{CI:'true'});assert.equal(await readFile(join(directory,'pnpm-lock.yaml'),'utf8'),lock)
  for(const action of['typecheck','test','build']){
    const output=await command('pnpm',['exec','longhorn',action,'--cwd',directory],consumer)
    if(runtime==='bun'&&action==='test')console.log(output.trim())
  }
  const appBinary=runtime==='node'?process.execPath:join(dirname(createRequire(join(directory,'package.json')).resolve('bun-runtime/package.json')),'bin/bun.exe')
  await command(appBinary,['tests/persistence.mjs'],directory)
  console.log(runtime+' SQLite starter distribution: actual source snapshot, installed packed binaries/automatic install, relocation/frozen dependency graph, types/source tests/build and shipped native multi-process persistence/integrity gate verified.')
  await writeFile(join(directory,'.env'),'APP_NAME=base-file\nDATABASE_PATH=./wrong.sqlite\n')
  await writeFile(join(directory,'.env.local'),'APP_NAME=local-file\nDATABASE_PATH="./retained/tasks #1.sqlite"\n')
  const cli=join(consumer,'node_modules/@longhorn/cli/dist/bin.js'),start=environment=>launch(process.execPath,[cli,'start','--cwd',directory],consumer,environment)
  let first=start(),url=await listening(first)
  assert.equal((await(await fetch(url+'/')).json()).name,'local-file')
  let response=await fetch(url+'/tasks',post('  retained SQLite task  '));assert.equal(response.status,201);const original=(await response.json()).task
  assert.equal(original.title,'retained SQLite task')
  const activity=await(await fetch(url+'/activity')).json();assert.equal(activity.activity.created,1);assert.equal(activity.activity.latest.requestId,response.headers.get('X-Request-Id'))
  const second=start({APP_NAME:'process-setting'}),secondUrl=await listening(second)
  assert.equal((await(await fetch(secondUrl+'/')).json()).name,'process-setting')
  assert.deepEqual(await taskAt(secondUrl,original.id),original)
  assert.equal((await(await fetch(url+'/summary')).json()).summary.total,1)
  response=await fetch(secondUrl+'/tasks',post('external writer'));assert.equal(response.status,201)
  assert.equal((await(await fetch(url+'/tasks?limit=100')).json()).tasks.length,2)
  await waitFor(first,async()=> (await(await fetch(url+'/summary')).json()).summary.total===2)
  assert.equal((await(await fetch(url+'/activity')).json()).activity.created,1)
  const created=await Promise.all(Array.from({length:24},async(_,index)=>{const response=await fetch((index%2?url:secondUrl)+'/tasks',post('writer '+index));assert.equal(response.status,201);return(await response.json()).task}))
  assert.equal(new Set(created.map(task=>task.id)).size,24)
  response=await fetch(url+'/tasks/'+original.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"completed":true}'});assert.equal(response.status,200)
  response=await fetch(url+'/tasks/'+created[0].id,{method:'DELETE'});assert.equal(response.status,204)
  await stop(first);await stop(second);assert.ok(first.records.some(row=>row.message==='Application stopped'));assert.ok(second.records.some(row=>row.message==='Application stopped'))
  // Launch the compiled host directly from a different cwd: data/env still resolve from the project.
  first=launch(appBinary,[join(directory,'dist/index.js')],consumer,runtime==='bun'?{APP_NAME:'direct-environment',DATABASE_PATH:'./retained/tasks #1.sqlite'}:{});url=await listening(first)
  assert.equal((await(await fetch(url+'/')).json()).name,runtime==='bun'?'direct-environment':'local-file');assert.equal((await taskAt(url,original.id)).completed,true)
  assert.equal((await fetch(url+'/tasks/'+created[0].id)).status,404)
  assert.equal((await(await fetch(url+'/tasks?limit=100')).json()).tasks.length,25)
  assert.deepEqual((await(await fetch(url+'/activity')).json()).activity,{created:0,updated:0,deleted:0})
  assert.equal((await(await fetch(url+'/summary')).json()).summary.total,25)
  await stop(first)
  const filename=join(directory,'retained/tasks #1.sqlite');assert.equal((await readFile(filename)).subarray(0,16).toString(),'SQLite format 3\0');await assert.rejects(access(join(directory,'wrong.sqlite')))
  console.log(runtime+' installed SQLite HTTP: CLI env-file/process precedence, project-relative data paths from another cwd, two native writers, persisted CRUD/nonreused IDs, local-only activity and TTL-bounded derived cache across host restart verified.')
  const development=launch(process.execPath,[cli,'dev','--cwd',directory],consumer)
  url=await listening(development);const sourcePath=join(directory,'src/app.ts'),source=await readFile(sourcePath,'utf8');assert.ok(source.includes("status: 'ok'"))
  if(runtime==='bun'){
    const starts=development.records.filter(row=>row.message==='HTTP server listening').length
    await writeFile(sourcePath,source+'\ninvalid syntax !!!\n')
    await waitFor(development,()=>development.records.some(row=>row.message==='Bun SQLite development build failed'))
    assert.equal((await(await fetch(url+'/health')).json()).status,'ok')
    assert.equal(development.records.filter(row=>row.message==='HTTP server listening').length,starts)
  }
  await writeFile(sourcePath,source.replace("status: 'ok'","status: 'edited'"))
  await waitFor(development,async()=>{try{return(await(await fetch(latest(development)+'/health',{signal:AbortSignal.timeout(500)})).json()).status==='edited'}catch{return false}})
  url=latest(development);assert.equal((await taskAt(url,original.id)).completed,true)
  await stop(development);assert.ok(development.records.some(row=>row.message==='Application stopped'),development.output());await assert.rejects(fetch(url+'/health',{signal:AbortSignal.timeout(1000)}))
  await writeFile(sourcePath,source)
  if(runtime==='bun')assert.ok(development.records.some(row=>row.message==='Development stopped'),development.output())
  const invalidPath=join(temporary,'invalid/data.sqlite'),invalid=launch(appBinary,[join(directory,'dist/index.js')],consumer,{PORT:'invalid',DATABASE_PATH:invalidPath})
  assert.equal((await invalid.ended).code,1);await assert.rejects(access(join(temporary,'invalid')))
  const schemaPath=join(directory,'src/sqlite-tasks.ts'),schema=await readFile(schemaPath,'utf8');assert.ok(schema.includes('CREATE TABLE tasks ('))
  await writeFile(schemaPath,schema.replace('CREATE TABLE tasks (','CREATE TABLE tasks ( '));await command('pnpm',['run','build'],directory)
  const drift=runtime==='bun'?launch(process.execPath,[cli,'dev','--cwd',directory],consumer):start();assert.equal((await drift.ended).code,1);assert.ok(!drift.records.some(row=>row.message==='HTTP server listening'))
  await writeFile(schemaPath,schema);await command('pnpm',['run','build'],directory)
  first=start();url=await listening(first);assert.equal((await taskAt(url,original.id)).completed,true);await stop(first)
  assert.ok(!(await readdir(temporary)).some(name=>name.startsWith('.longhorn-create-')))
  console.log(runtime+' installed SQLite development/failures: source watching retains data and drains native hosts; '+(runtime==='bun'?'failed compilation retains the old host; ':'')+'invalid config creates no directory; changed applied schema rejects readiness and restored source reopens retained state.')
}finally{await Promise.all([...instances].map(stop));await rm(temporary,{recursive:true,force:true})}
