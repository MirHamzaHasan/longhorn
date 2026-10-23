import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const root=fileURLToPath(new URL('..',import.meta.url)),json=value=>JSON.stringify(value,null,2)+'\n'
async function freezeDependencies(directory){
  // Resolve the archive's own graph without installing packages or running hooks.
  // Explicitly allow a new lockfile even when packaging runs inside CI.
  await promisify(execFile)('pnpm',['install','--lockfile-only','--no-frozen-lockfile','--ignore-scripts','--reporter=append-only'],{cwd:directory,maxBuffer:2*1024*1024})
  const lock=await readFile(join(directory,'pnpm-lock.yaml'),'utf8')
  if(lock.includes(root)||lock.includes(directory)||lock.includes('workspace:'))throw new Error('Dependency lock contains a workspace reference')
  const file=join(directory,'.longhorn/distribution.json'),metadata=JSON.parse(await readFile(file,'utf8'))
  metadata.dependencyLock={file:'pnpm-lock.yaml',sha256:createHash('sha256').update(lock).digest('hex'),packageManager:'pnpm@12.6.0'}
  await writeFile(file,json(metadata))
}
async function empty(directory){
  try{const info=await lstat(directory);if(info.isSymbolicLink()||!info.isDirectory()||(await readdir(directory)).length)throw new Error('Command application destination must be an empty directory')}
  catch(error){if(error.code!=='ENOENT')throw error}
}
/** Publish an editable independent application, never an install or a deployment. */
export async function createCommandApplication(destination){
  const directory=resolve(destination);await empty(directory)
  const framework=join(root,'cli/dist/framework'),manifest=JSON.parse(await readFile(join(framework,'manifest.json'),'utf8'))
  const example=JSON.parse(await readFile(join(root,'examples/postgres/package.json'),'utf8'))
  const direct=[...Object.keys(example.dependencies).filter(name=>name.startsWith('@longhorn/')),'@longhorn/workers','@longhorn/runtime'],selected=new Set()
  function include(name){if(selected.has(name))return;const entry=manifest.packages[name];if(!entry||!/^\w+$/.test(entry.directory))throw new Error('Incomplete built framework snapshot');selected.add(name);for(const dependency of Object.keys(entry.dependencies))if(dependency.startsWith('@longhorn/'))include(dependency)}
  for(const name of direct)include(name)
  const locations=Object.fromEntries([...selected].sort().map(name=>[name,'file:./.longhorn/framework/'+manifest.packages[name].directory]))
  await mkdir(dirname(directory),{recursive:true});const staging=await mkdtemp(join(dirname(directory),'.command-app-'))
  try{
    await cp(join(root,'starters/command-app'),staging,{recursive:true})
    await cp(join(root,'LICENSE'),join(staging,'LICENSE'))
    await cp(join(root,'examples/postgres/src'),join(staging,'src'),{recursive:true,filter:source=>!source.endsWith('.postgres.test.ts')})
    await cp(join(root,'examples/postgres/console'),join(staging,'console'),{recursive:true})
    for(const name of ['receiver.ts','receipts.ts','contracts.ts','message-effect.ts']){await mkdir(join(staging,'receiver'),{recursive:true});await cp(join(root,'examples/outbox-worker/src',name),join(staging,'receiver',name))}
    for(const name of selected)await cp(join(framework,manifest.packages[name].directory),join(staging,'.longhorn/framework',manifest.packages[name].directory),{recursive:true})
    const receiver=(await readFile(join(root,'scripts/serve-message-receiver.mjs'),'utf8')).replace("'../packages/auth/dist/bearer.js'","'@longhorn/auth/bearer'").replace("'../packages/runtime/dist/index.js'","'@longhorn/runtime'").replace("'../examples/outbox-worker/data/receiver'","'../data/receiver'").replace("'../examples/outbox-worker/dist/receiver.js'","'../dist/receiver/receiver.js'")
    await writeFile(join(staging,'scripts/serve-receiver.mjs'),receiver)
    const dependencies=Object.fromEntries(direct.map(name=>[name,locations[name]]))
    await writeFile(join(staging,'package.json'),json({name:'longhorn-command-app',version:'0.1.0-dev',private:true,type:'module',packageManager:'pnpm@12.6.0',engines:{node:'>=20.19.0'},longhorn:{schemaVersion:1,runtime:'node',framework:'snapshot',application:'commands'},scripts:{build:'node build.mjs',start:'node dist/operator-host.js',dev:'pnpm build && node --watch dist/operator-host.js',receiver:'node scripts/serve-receiver.mjs',migrate:'node dist/migrate-operations.js',operator:'node dist/operator-role.js','provision:runtime':'node scripts/provision-runtime.mjs','state:backup':'node scripts/state-backup.mjs backup','state:restore':'node scripts/state-backup.mjs restore',typecheck:'tsc --noEmit && tsc -p console/tsconfig.json --noEmit && tsc -p receiver/tsconfig.json --noEmit',test:'vitest run'},dependencies:{...dependencies,hono:example.dependencies.hono,zod:example.dependencies.zod,miniflare:'3.20250718.3'},devDependencies:{'@types/node':'^22.13.10','@cloudflare/workers-types':'^5.20261022.1',esbuild:'^0.28.2',typescript:'^5.8.2',vitest:'^3.1.1'}}))
    await writeFile(join(staging,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(locations).map(([name,value])=>'  '+JSON.stringify(name)+': '+JSON.stringify(value)).join('\n')+'\n\nallowBuilds:\n  esbuild: true\n  workerd: true\n')
    const compiler={target:'ES2022',module:'ESNext',moduleResolution:'Bundler',lib:['ES2022','DOM'],types:['node'],strict:true,noEmit:true,skipLibCheck:true,verbatimModuleSyntax:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true}
    await writeFile(join(staging,'tsconfig.json'),json({compilerOptions:compiler,include:['src/**/*.ts']}))
    await writeFile(join(staging,'console/tsconfig.json'),json({extends:'../tsconfig.json',compilerOptions:{types:[],lib:['ES2022','DOM','DOM.Iterable']},include:['./**/*.ts']}))
    await writeFile(join(staging,'receiver/tsconfig.json'),json({extends:'../tsconfig.json',compilerOptions:{types:[]},include:['./**/*.ts']}))
    await cp(join(root,'examples/postgres/.operator.env.example'),join(staging,'.operator.env.example'))
    await writeFile(join(staging,'.gitignore'),'node_modules/\ndist/\ndata/\n.env\n.env.*\n!.env.example\n.operator.env\n.operator.env.local\n*.tsbuildinfo\n')
    await writeFile(join(staging,'.longhorn/distribution.json'),json({schemaVersion:1,application:'commands',frameworkPackages:[...selected].sort()}))
    await empty(directory);await rename(staging,directory)
    return directory
  }finally{await rm(staging,{recursive:true,force:true})}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const temporary=await mkdtemp(join(tmpdir(),'longhorn-command-package-'))
  try{
    const application=await createCommandApplication(join(temporary,'longhorn-command-app'))
    await freezeDependencies(application)
    await mkdir(join(root,'.artifacts'),{recursive:true})
    const archive=join(root,'.artifacts/longhorn-command-app.tgz'),pending=join(temporary,'command-app.tgz')
    await promisify(execFile)('tar',['-czf',pending,'-C',dirname(application),'longhorn-command-app'])
    await cp(pending,archive)
    await writeFile(archive+'.sha256',createHash('sha256').update(await readFile(archive)).digest('hex')+'  longhorn-command-app.tgz\n')
    console.log(JSON.stringify({message:'Command application packaged',archive}))
  }finally{await rm(temporary,{recursive:true,force:true})}
}
