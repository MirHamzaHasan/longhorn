import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createProject } from '../cli/dist/index.js'

const root=fileURLToPath(new URL('..',import.meta.url)),json=value=>JSON.stringify(value,null,2)+'\n'
export async function freezeCommandDependencies(directory){
  // Resolve the archive's own graph without installing packages or running hooks.
  // Explicitly allow a new lockfile even when packaging runs inside CI.
  await promisify(execFile)('pnpm',['install','--lockfile-only','--no-frozen-lockfile','--ignore-scripts','--reporter=append-only'],{cwd:directory,maxBuffer:2*1024*1024})
  const lock=await readFile(join(directory,'pnpm-lock.yaml'),'utf8')
  if(lock.includes(root)||lock.includes(directory)||lock.includes('workspace:'))throw new Error('Dependency lock contains a workspace reference')
  const file=join(directory,'.longhorn/distribution.json'),metadata=JSON.parse(await readFile(file,'utf8'))
  metadata.dependencyLock={file:'pnpm-lock.yaml',sha256:createHash('sha256').update(lock).digest('hex'),packageManager:'pnpm@12.6.0'}
  await writeFile(file,json(metadata))
}
/** Use the same checked source/assets and atomic publication as CLI generation. */
export async function createCommandApplication(destination){
  const project=await createProject({directory:destination,name:'longhorn-command-app',runtime:'node',template:'command-app'})
  return project.directory
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const temporary=await mkdtemp(join(tmpdir(),'longhorn-command-package-'))
  try{
    const application=await createCommandApplication(join(temporary,'longhorn-command-app'))
    await freezeCommandDependencies(application)
    await mkdir(join(root,'.artifacts'),{recursive:true})
    const archive=join(root,'.artifacts/longhorn-command-app.tgz'),pending=join(temporary,'command-app.tgz')
    await promisify(execFile)('tar',['-czf',pending,'-C',dirname(application),'longhorn-command-app'])
    await cp(pending,archive)
    await writeFile(archive+'.sha256',createHash('sha256').update(await readFile(archive)).digest('hex')+'  longhorn-command-app.tgz\n')
    console.log(JSON.stringify({message:'Command application packaged',archive}))
  }finally{await rm(temporary,{recursive:true,force:true})}
}
