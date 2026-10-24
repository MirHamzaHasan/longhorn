import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename,delimiter,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { freezeCommandDependencies } from './package-command-app.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-command-project-')),instances=new Set()
async function run(binary,args,cwd=temporary,overrides={},expected=0){
  const env={...process.env,CI:'true',MIGRATION_DATABASE_URL:undefined,DATABASE_URL:undefined,...overrides}
  for(const [key,value]of Object.entries(env))if(value===undefined)delete env[key]
  const child=spawn(binary,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output=''
  child.stdout.on('data',value=>{output+=value});child.stderr.on('data',value=>{output+=value})
  const ended=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}))});instances.add(child)
  const timer=setTimeout(()=>{if(process.platform==='win32')child.kill('SIGKILL');else try{process.kill(-child.pid,'SIGKILL')}catch{}},180000)
  try{assert.equal((await ended).code,expected,output);return output}finally{clearTimeout(timer);instances.delete(child)}
}
async function scan(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=join(directory,entry.name)
    if(entry.isDirectory())await scan(file)
    else{assert.ok(entry.isFile(),'Unexpected generated asset');const value=await readFile(file,'utf8');assert.ok(!value.includes(root),'Generated workspace path');assert.ok(!value.includes('workspace:*'),'Generated workspace dependency')}
  }
}
async function compareSource(project){
  let count=0
  for(const [source,target]of[['examples/postgres/src','src'],['examples/postgres/console','console'],['starters/command-app/docs','docs']]){
    for(const entry of await readdir(join(root,source),{withFileTypes:true})){
      if(!entry.isFile()||entry.name.endsWith('.postgres.test.ts')||target==='console'&&entry.name==='tsconfig.json')continue
      assert.deepEqual(await readFile(join(project,target,entry.name)),await readFile(join(root,source,entry.name)),target+'/'+entry.name);count++
    }
  }
  for(const name of ['receiver.ts','receipts.ts','contracts.ts','message-effect.ts']){assert.deepEqual(await readFile(join(project,'receiver',name)),await readFile(join(root,'examples/outbox-worker/src',name)));count++}
  assert.deepEqual(await readFile(join(project,'LICENSE')),await readFile(join(root,'LICENSE')))
  return count
}
try{
  const cliPack=JSON.parse(await run('pnpm',['pack','--json','--pack-destination',temporary],join(root,'cli')))
  const creatorPack=JSON.parse(await run('pnpm',['pack','--json','--pack-destination',temporary],join(root,'create-longhorn')))
  assert.ok(cliPack.files.some(file=>file.path==='dist/framework/templates/command-app/template.json'))
  const installed=join(temporary,'installed CLI');await mkdir(installed)
  await writeFile(join(installed,'package.json'),JSON.stringify({private:true,packageManager:'pnpm@12.6.0',dependencies:{'@longhorn/cli':'file:../'+basename(cliPack.filename),'create-longhorn':'file:../'+basename(creatorPack.filename)}}))
  await writeFile(join(installed,'pnpm-workspace.yaml'),"overrides:\n  '@longhorn/cli': "+JSON.stringify('file:../'+basename(cliPack.filename))+'\n')
  await run('pnpm',['install','--no-frozen-lockfile','--reporter=append-only'],installed)
  const consumer=join(temporary,'relocated installed CLI');await rename(installed,consumer)
  const cli=join(consumer,'node_modules/@longhorn/cli/dist/bin.js'),creator=join(consumer,'node_modules/create-longhorn/dist/bin.js')
  const first=join(temporary,'first command console'),created=join(temporary,'created console'),project=join(temporary,'longhorn-command-app')
  const output=await run(process.execPath,[cli,'create',first,'--runtime','node','--template','command-app','--name','first-console'],consumer)
  assert.ok(output.includes('docs/setup.md')&&!output.includes('then pnpm dev'))
  assert.equal((await readdir(first)).includes('node_modules'),false);await scan(first)
  assert.equal((await readdir(first)).includes('pnpm-lock.yaml'),false,'Creation unexpectedly resolved dependencies')
  const compared=await compareSource(first),manifest=JSON.parse(await readFile(join(first,'package.json'),'utf8'))
  assert.equal(manifest.name,'first-console');assert.deepEqual(manifest.longhorn,{schemaVersion:1,runtime:'node',framework:'snapshot',template:'command-app',application:'commands'})
  const selected=await readdir(join(first,'.longhorn/framework'));assert.ok(selected.includes('node')&&selected.includes('workers'));assert.ok(!selected.includes('bun')&&!selected.includes('deno'))
  assert.ok((await readFile(join(first,'README.md'),'utf8')).startsWith('# first-console\n'))
  // Custom scripts and lifecycle hooks retain pnpm's script environment/exit status.
  const custom=join(temporary,'custom script owner');await mkdir(join(custom,'dist'),{recursive:true})
  const script="console.log(JSON.stringify({event:process.env.npm_lifecycle_event}));process.exitCode=17\n"
  await writeFile(join(custom,'custom.mjs'),script);await writeFile(join(custom,'dist/operator-host.js'),script)
  for(const scripts of [{start:'node custom.mjs'},{start:'node dist/operator-host.js',prestart:'node -e "process.exit(0)"'}]){
    await writeFile(join(custom,'package.json'),JSON.stringify({type:'module',private:true,packageManager:'pnpm@12.6.0',longhorn:{schemaVersion:1,runtime:'node',template:'command-app'},scripts}))
    const result=await run(process.execPath,[cli,'start','--cwd',custom],consumer,{},17)
    assert.ok(result.split('\n').some(line=>line==='{"event":"start"}'),'pnpm delegation was bypassed')
  }
  for(const runtime of ['bun','deno','workers']){
    const refused=join(temporary,'refused-'+runtime),error=await run(process.execPath,[creator,refused,'--runtime',runtime,'--template','command-app'],consumer,{},1)
    assert.ok(error.includes('requires --runtime node'));await assert.rejects(lstat(refused),{code:'ENOENT'})
  }
  const occupied=join(temporary,'occupied');await mkdir(occupied);await writeFile(join(occupied,'.keep'),'retain')
  await run(process.execPath,[creator,occupied,'--runtime','node','--template','command-app'],consumer,{},1);assert.equal(await readFile(join(occupied,'.keep'),'utf8'),'retain')
  const assets=await realpath(join(consumer,'node_modules/@longhorn/cli/dist/framework/templates/command-app'));assert.ok(assets.startsWith(await realpath(temporary)))
  const receiverFile=join(assets,'receiver/receiver.ts'),receiverBytes=await readFile(receiverFile)
  try{
    await writeFile(receiverFile,'damaged installed receipt receiver')
    const refused=join(temporary,'damaged receiver'),error=await run(process.execPath,[creator,refused,'--runtime','node','--template','command-app'],consumer,{},1)
    assert.ok(error.includes('assets are unavailable or invalid'));await assert.rejects(lstat(refused),{code:'ENOENT'})
  }finally{await writeFile(receiverFile,receiverBytes)}
  const descriptorFile=join(assets,'template.json'),descriptorBytes=await readFile(descriptorFile)
  try{
    const descriptor=JSON.parse(descriptorBytes);delete descriptor.files['docs/setup.md'];await writeFile(descriptorFile,JSON.stringify(descriptor))
    const refused=join(temporary,'missing setup'),error=await run(process.execPath,[creator,refused,'--runtime','node','--template','command-app'],consumer,{},1)
    assert.ok(error.includes('assets are unavailable or invalid'));await assert.rejects(lstat(refused),{code:'ENOENT'})
  }finally{await writeFile(descriptorFile,descriptorBytes)}
  if(process.platform!=='win32'){
    const bin=join(temporary,'failed installer');await mkdir(bin);await writeFile(join(bin,'pnpm'),'#!/usr/bin/env node\nprocess.exit(27)\n');await chmod(join(bin,'pnpm'),0o755)
    const retained=join(temporary,'retained failed install'),failure=await run(process.execPath,[creator,retained,'--runtime','node','--template','command-app','--install'],consumer,{PATH:bin+delimiter+process.env.PATH},27)
    assert.ok(failure.includes('Project files were created. pnpm install failed (27)'));assert.equal(await compareSource(retained),compared)
  }
  const installedOutput=await run(process.execPath,[creator,created,'--runtime','node','--template','command-app','--name','installed-console','--install'],consumer)
  assert.ok(installedOutput.includes('docs/setup.md'));await rename(created,project);assert.equal(await compareSource(project),compared)
  const lock=await readFile(join(project,'pnpm-lock.yaml'),'utf8');await run('pnpm',['install','--frozen-lockfile','--reporter=append-only'],project);assert.equal(await readFile(join(project,'pnpm-lock.yaml'),'utf8'),lock)
  await rm(join(project,'node_modules'),{recursive:true,force:true});await scan(project)
  await freezeCommandDependencies(project);assert.equal(await readFile(join(project,'pnpm-lock.yaml'),'utf8'),lock)
  await mkdir(join(root,'.artifacts'),{recursive:true})
  const archive=join(root,'.artifacts/longhorn-command-project.tgz');await run('tar',['-czf',archive,'-C',temporary,'longhorn-command-app'])
  const sha256=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(archive+'.sha256',sha256+'  longhorn-command-project.tgz\n')
  console.log('Packed command profile: both relocated installed entrypoints, offline creation, source equality, selected graph, names, runtime/occupied/corrupt/missing refusals, retained install failure and actual CI-mode install/frozen relocation verified.')
  // The installed CLI starts each app host and runs its typecheck/test/build scripts.
  const workflow=await run(process.execPath,[join(root,'scripts/verify-command-app.mjs'),'--archive',archive,'--cli',cli],root)
  process.stdout.write(workflow)
  await writeFile(join(root,'.artifacts/command-project-proof.json'),JSON.stringify({application:'commands',template:'command-app',runtime:'node',installedEntrypoints:['longhorn','create-longhorn'],sourceFilesCompared:compared,offlineCreation:true,ciInstall:true,frozenRelocation:true,corruptAndMissingRefused:true,failedInstallRetained:process.platform!=='win32',customScriptAndHookDelegation:true,cliScriptAndStartWorkflow:true,terminalGroupInterrupt:process.platform!=='win32',realPostgresReceiverBrowserRestore:true,archiveSha256:sha256},null,2)+'\n')
  assert.equal((await readdir(temporary)).some(name=>name.startsWith('.longhorn-create-')),false)
  console.log('Command project: installed CLI owns real host start/stop/restart and the full restored browser workflow; source/assets and native artifact proof saved.')
}finally{
  for(const child of instances){if(process.platform==='win32')child.kill('SIGKILL');else try{process.kill(-child.pid,'SIGKILL')}catch{}}
  await rm(temporary,{recursive:true,force:true})
}
