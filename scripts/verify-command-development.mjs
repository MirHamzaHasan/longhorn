import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash,randomUUID } from 'node:crypto'
import { openPostgres } from '../runtimes/node/dist/postgres.js'

/** Operates only on the gate's extracted app and already restored test database. */
export async function verifyCommandDevelopment({directory,cli,origin,receiverEnvironment,ownerUrl,username,password}){
  const children=[],originals=new Map(),secrets=[ownerUrl,password,receiverEnvironment.RECEIVER_TOKEN]
  let owner,locking,releaseLock,posting,releaseForced
  const sleep=ms=>new Promise(done=>setTimeout(done,ms)),safe=value=>{for(const secret of secrets)value=value.replaceAll(secret,'[redacted]');return value}
  async function waitFor(action,instance){const end=Date.now()+25000;while(Date.now()<end){const result=await action();if(result)return result;if(instance&&instance.child.exitCode!==null)throw new Error(safe(instance.output()));await sleep(25)}throw new Error('Command development condition timed out')}
  function launch(receiver=false){
    const env={...process.env,...(receiver?receiverEnvironment:{}),MIGRATION_DATABASE_URL:undefined};for(const[key,value]of Object.entries(env))if(value===undefined)delete env[key]
    const child=spawn(process.execPath,receiver?['dev.mjs','--receiver']:[cli,'dev','--cwd',directory],{cwd:directory,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='';const records=[]
    for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
    child.once('error',()=>{});const value={child,records,output:()=>output,ended:new Promise(done=>child.once('close',(code,signal)=>done({code,signal})))};children.push(value);return value
  }
  async function stop(instance,group=false){
    if(instance.child.exitCode===null&&instance.child.signalCode===null){if(group&&process.platform!=='win32')process.kill(-instance.child.pid,'SIGINT');else instance.child.kill('SIGTERM')}
    const timer=setTimeout(()=>{try{if(process.platform==='win32')instance.child.kill('SIGKILL');else process.kill(-instance.child.pid,'SIGKILL')}catch{}},15000)
    try{const result=await instance.ended;assert.equal(result.code,0,safe(instance.output()))}finally{clearTimeout(timer)}
  }
  const count=(instance,message)=>instance.records.filter(row=>row.message===message).length
  const listening=(instance,after=0)=>waitFor(()=>{const rows=instance.records.filter(row=>row.message==='HTTP server listening');return rows.length>after&&rows.at(-1).fields.url},instance)
  const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(5000)})
  async function keep(path){const file=join(directory,path);try{originals.set(file,await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;originals.set(file,undefined)}return file}
  try{
    const hostFile=await keep('src/operator-host.ts'),cssFile=await keep('console/app.css'),receiverFile=await keep('receiver/receiver.ts'),profile=await keep('.operator.env.local')
    const hostBase=originals.get(hostFile),cssBase=originals.get(cssFile),receiverBase=originals.get(receiverFile)
    const hostSource=marker=>{const needle='  const server=await app.listen';assert.ok(hostBase.includes(needle));return hostBase.replace(needle,"  app.http.get('/development-check',c=>c.json({generation:'"+marker+"'}))\n"+needle)}
    await writeFile(hostFile,hostSource('first'));await writeFile(cssFile,cssBase+'\n:root{--longhorn-development:first}\n')
    const receiver=launch(true),receiverOrigin=await listening(receiver)
    await writeFile(hostFile,hostSource('first')+'\nconst = initial invalid source\n')
    const app=launch();await waitFor(()=>count(app,'Command development build failed')>0,app);assert.equal(count(app,'HTTP server listening'),0);await assert.rejects(get('/livez'))
    await writeFile(hostFile,hostSource('first'));assert.equal(await listening(app),origin)
    assert.equal((await(await get('/development-check')).json()).generation,'first');assert.ok((await(await get('/console/app.css')).text()).includes('--longhorn-development:first'))
    const post=input=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)})
    const login=await fetch(origin+'/account/login',post({username,password}));assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];secrets.push(cookie.split('=')[1])
    const history=await(await fetch(origin+'/account/commands',{headers:{Cookie:cookie}})).json(),retainedId=history.commands[0].id
    const receipt=async id=>{const r=await fetch(origin+'/account/commands/'+id+'/receipt',{headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)});return r.ok?await r.json():undefined}
    const retainedReceipt=(await receipt(retainedId)).receipts
    const starts=count(app,'HTTP server listening'),failed=count(app,'Command development build failed'),built=join(directory,'dist/operator-host.js'),builtHash=createHash('sha256').update(await readFile(built)).digest('hex'),builtCss=join(directory,'dist/console/app.css'),cssHash=createHash('sha256').update(await readFile(builtCss)).digest('hex')
    await writeFile(hostFile,hostSource('invalid')+'\nconst = invalid source\n');await writeFile(cssFile,cssBase+'\n:root{--longhorn-development:unpublished}\n')
    await waitFor(()=>count(app,'Command development build failed')>failed,app);assert.equal(count(app,'HTTP server listening'),starts);assert.equal((await(await get('/development-check')).json()).generation,'first');assert.ok(!(await(await get('/console/app.css')).text()).includes('unpublished'));assert.equal(createHash('sha256').update(await readFile(built)).digest('hex'),builtHash);assert.equal(createHash('sha256').update(await readFile(builtCss)).digest('hex'),cssHash)
    await writeFile(hostFile,hostSource('second'));await writeFile(cssFile,cssBase+'\n:root{--longhorn-development:second}\n');await listening(app,starts)
    assert.equal((await(await get('/development-check')).json()).generation,'second');assert.ok((await(await get('/console/app.css')).text()).includes('--longhorn-development:second'))
    const nested=await keep('src/development-proof/deep/marker.ts');await mkdir(join(nested,'..'),{recursive:true});await writeFile(nested,"export const developmentMarker='nested-first'\n")
    const nestedSource=hostSource('nested').replace("import { loadConfig }", "import { developmentMarker } from './development-proof/deep/marker.js'\nimport { loadConfig }").replace("generation:'nested'",'generation:developmentMarker')
    let nestedBefore=count(app,'HTTP server listening');await writeFile(hostFile,nestedSource);await listening(app,nestedBefore);assert.equal((await(await get('/development-check')).json()).generation,'nested-first')
    nestedBefore=count(app,'HTTP server listening');await writeFile(nested,"export const developmentMarker='nested-second'\n");await listening(app,nestedBefore);assert.equal((await(await get('/development-check')).json()).generation,'nested-second')
    // Real admitted HTTP waits on SQL while the old child is asked to drain.
    owner=await openPostgres({connectionString:ownerUrl});let lockHeld=false,pid
    const gate=new Promise(done=>{releaseLock=done});locking=owner.transaction(async tx=>{pid=(await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid;await tx.execute('LOCK TABLE longhorn_pg_example.operator_commands IN ACCESS EXCLUSIVE MODE');lockHeld=true;await gate});await waitFor(()=>lockHeld)
    const input={id:'development-drain-'+randomUUID(),numbers:[12,30]};let settled=false
    posting=fetch(origin+'/account/commands',{...post(input),headers:{...post(input).headers,Cookie:cookie}}).then(async response=>{settled=true;assert.equal(response.status,201);return response.json()});void posting.catch(()=>{})
    await waitFor(async()=>(await owner.execute({sql:'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS blocked',args:[pid]})).rows[0].blocked===true)
    const before=count(app,'HTTP server listening'),stops=count(app,'Command development host stopping');await writeFile(hostFile,hostSource('drained'))
    await waitFor(()=>count(app,'Command development host stopping')>stops,app);await sleep(150);assert.equal(settled,false);assert.equal(count(app,'HTTP server listening'),before)
    // Several newer generations arrive while the admitted native request owns shutdown.
    for(let i=0;i<4;i++)await writeFile(hostFile,hostSource('latest-'+i))
    releaseLock();await locking;locking=undefined;const committed=await posting;posting=undefined;await listening(app,before)
    await waitFor(async()=>{try{return(await(await get('/development-check')).json()).generation==='latest-3'}catch{return false}},app)
    const replay=await fetch(origin+'/account/commands',{...post(input),headers:{...post(input).headers,Cookie:cookie}});assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),committed)
    await waitFor(async()=>{const value=await receipt(committed.command.id);return value?.receipts[0]?.result.sum===42},app)
    assert.equal((await owner.execute('SELECT count(*)::integer AS total FROM longhorn_pg_example.operator_commands')).rows[0].total,history.commands.length+1)
    const appBefore=count(app,'HTTP server listening'),receiverBefore=count(receiver,'HTTP server listening'),receiverFailed=count(receiver,'Command development build failed')
    await writeFile(receiverFile,receiverBase+'\nconst = invalid receiver\n');await waitFor(()=>count(receiver,'Command development build failed')>receiverFailed,receiver)
    const bearer={Authorization:'Bearer '+receiverEnvironment.RECEIVER_TOKEN};assert.equal((await fetch(receiverOrigin+'/health',{headers:bearer})).status,200);assert.equal(count(receiver,'HTTP server listening'),receiverBefore)
    await writeFile(receiverFile,receiverBase.replace('export default createWorker(app)',"app.http.get('/development-check',c=>c.json({generation:'receiver-source'}))\nexport default createWorker(app)"));await listening(receiver,receiverBefore)
    assert.equal((await(await fetch(receiverOrigin+'/development-check',{headers:bearer})).json()).generation,'receiver-source');assert.deepEqual((await receipt(retainedId)).receipts,retainedReceipt);assert.equal(count(app,'HTTP server listening'),appBefore)
    const configBefore=count(app,'HTTP server listening'),nextProfile=await keep('.operator.env.local.next');await writeFile(nextProfile,'LOG_LEVEL=debug\n');await rename(nextProfile,profile);await listening(app,configBefore);assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:cookie}})).status,200)
    await writeFile(profile,'PORT=invalid\n');assert.equal((await app.ended).code,1);assert.ok(app.records.some(row=>row.message==='Command development host exited'))
    await writeFile(profile,'LOG_LEVEL=info\n');const restarted=launch();assert.equal(await listening(restarted),origin);assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:cookie}})).status,200)
    const removalBefore=count(restarted,'HTTP server listening');await rm(profile);await listening(restarted,removalBefore);assert.equal((await fetch(origin+'/account/session',{headers:{Cookie:cookie}})).status,200)
    await stop(restarted,true);await assert.rejects(get('/livez'));await stop(receiver,true);await assert.rejects(fetch(receiverOrigin+'/health',{headers:bearer,signal:AbortSignal.timeout(3000)}))
    // A noncooperative native process must be reported as a failed stop, not a clean drain.
    const hostModule=await import(pathToFileURL(join(directory,'dev-host.mjs'))),forcedReady=await keep('.development-force-ready');await keep('dist/operator-host.js')
    await writeFile(built,"import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync('.development-force-ready','ready');setInterval(()=>{},1000)\n")
    const forced=hostModule.startHost('app',new AbortController().signal);releaseForced=()=>hostModule.stopHost(forced)
    await waitFor(async()=>{try{return(await readFile(forcedReady,'utf8'))==='ready'}catch{return false}})
    await assert.rejects(releaseForced(),/did not close successfully/);releaseForced=undefined
    for(const child of children)for(const secret of secrets)assert.ok(!child.output().includes(secret),'Development logged a credential')
    await writeFile('.artifacts/command-development-proof.json',JSON.stringify({appAndConsoleSource:true,initialCompileWait:true,recursiveNewModule:true,failedBuildKeepsHostAndOutput:true,serialSqlDrain:true,latestDuringDrain:true,liveReplayAndSessionPreserved:true,computedReceipt:42,receiverSourceAndRetainedReceipt:true,separateOutputOwners:true,profileReload:true,atomicProfileCreation:true,profileRemoval:true,invalidProfileFailsOwner:true,forcedStopIsFailure:true,terminalGroupInterrupt:process.platform!=='win32',credentialsOmitted:true},null,2)+'\n')
    console.log('Command development: real app/console and separate receiver source edits, failed-build retention, latest-generation native SQL/HTTP drain, replay/session/receipt persistence, profile reload/failure, installed CLI ownership and POSIX terminal-group cleanup verified.')
  }finally{
    releaseLock?.();await locking?.catch(()=>{});await posting?.catch(()=>{})
    for(const child of children)if(child.child.exitCode===null&&child.child.signalCode===null)await stop(child).catch(()=>{})
    await releaseForced?.().catch(()=>{})
    await owner?.close()
    for(const[file,value]of originals)if(value===undefined)await rm(file,{force:true});else await writeFile(file,value)
  }
}
