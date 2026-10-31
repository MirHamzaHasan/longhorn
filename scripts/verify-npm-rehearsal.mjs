// Rehearses a release without touching npm: pack every public package, check each tarball,
// install them in an empty folder, generate a project with create-longhorn and start it.
import assert from 'node:assert/strict'
import { execFile,spawn } from 'node:child_process'
import { access,mkdir,mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-npm-rehearsal-'))
const shell=process.platform==='win32',tarballs=join(temporary,'tarballs'),stranger=join(temporary,'stranger')
const groups=await Promise.all(['packages','runtimes'].map(async group=>(await readdir(join(root,group),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>join(group,entry.name))))
const directories=[...groups.flat(),'cli','create-longhorn']
let host
async function secrets(directory){
  const pattern=/ghp_[A-Za-z0-9]{20}|npm_[A-Za-z0-9]{30}|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|\/Users\/[a-z]|\/home\/runner/,found=[]
  for(const entry of await readdir(directory,{withFileTypes:true,recursive:true})){
    if(entry.isFile()&&pattern.test(await readFile(join(entry.parentPath??entry.path,entry.name),'latin1')))found.push(entry.name)
  }
  return found
}
try{
  const{version}=JSON.parse(await readFile(join(root,'cli/package.json'),'utf8'))
  await mkdir(tarballs);await mkdir(stranger)
  for(const directory of directories){
    await run('pnpm',['pack','--pack-destination',tarballs],{cwd:join(root,directory),shell})
    const pkg=JSON.parse(await readFile(join(root,directory,'package.json'),'utf8'))
    assert.equal(pkg.version,version,`${pkg.name} version`)
    assert.equal(pkg.private,undefined,`${pkg.name} is private`)
    assert.equal(pkg.license,'MIT',`${pkg.name} license`)
    assert.ok(pkg.description,`${pkg.name} description`)
    assert.equal(pkg.repository?.directory,directory,`${pkg.name} repository`)
    assert.equal(pkg.publishConfig?.access,'public',`${pkg.name} access`)
  }
  const files=(await readdir(tarballs)).filter(name=>name.endsWith('.tgz'))
  assert.equal(files.length,directories.length)
  for(const file of files){
    const{stdout:list}=await run('tar',['-tzf',join(tarballs,file)],{maxBuffer:16777216}),paths=list.trim().split('\n')
    assert.ok(paths.includes('package/LICENSE'),`${file} has no LICENSE`)
    assert.ok(paths.some(path=>path.startsWith('package/dist/')),`${file} has no dist`)
    // Templates ship .env.example on purpose. Any other env file, or npm or git state, must not ship.
    assert.ok(!paths.some(path=>/(^|\/)(\.env(?!\.example$)[^/]*|\.npmrc|\.git\/)/.test(path)),`${file} has a private file`)
    const{stdout:manifest}=await run('tar',['-xzOf',join(tarballs,file),'package/package.json'],{maxBuffer:16777216})
    assert.ok(!manifest.includes('workspace:'),`${file} still names workspace dependencies`)
    const unpacked=join(temporary,'unpacked',file);await mkdir(unpacked,{recursive:true});await run('tar',['-xzf',join(tarballs,file),'-C',unpacked])
    for(const found of await secrets(unpacked))assert.fail(`${file} contains a secret or personal path: ${found}`)
  }
  console.log(`npm rehearsal: ${files.length} tarballs at ${version} carry a license, metadata and built output, and no workspace references, private files or secrets.`)
  await writeFile(join(stranger,'package.json'),'{"name":"stranger","private":true}\n')
  await run('npm',['install','--no-audit','--no-fund','--silent',...files.map(file=>join(tarballs,file))],{cwd:stranger,shell,maxBuffer:16777216})
  await run('npx',['--no-install','create-longhorn','my-api','--runtime','node'],{cwd:stranger,shell})
  // npm, unlike pnpm, renames some files on install, so every template has to be generated from this install.
  const templates=[['bun'],['deno'],['workers'],['node','sqlite-tasks'],['bun','sqlite-tasks'],['deno','sqlite-tasks'],['node','sqlite-auth'],['bun','sqlite-auth'],['deno','sqlite-auth'],['workers','d1-tasks'],['node','command-app']]
  for(const[runtime,template]of templates){
    const name=[runtime,template].filter(Boolean).join('-')
    await run('npx',['--no-install','create-longhorn',name,'--runtime',runtime,...(template?['--template',template]:[])],{cwd:stranger,shell})
    await access(join(stranger,name,'package.json'))
    if(template)await access(join(stranger,name,'.gitignore'))
  }
  console.log(`npm rehearsal: all ${templates.length+1} runtime and template choices generate from the npm-installed packages.`)
  await run('pnpm',['install'],{cwd:join(stranger,'node-sqlite-tasks'),shell,maxBuffer:16777216,env:{...process.env,CI:'',npm_config_frozen_lockfile:'false'}})
  await run('pnpm',['build'],{cwd:join(stranger,'node-sqlite-tasks'),shell})
  const project=join(stranger,'my-api')
  await run('pnpm',['install'],{cwd:project,shell,maxBuffer:16777216,env:{...process.env,CI:'',npm_config_frozen_lockfile:'false'}})
  await run('pnpm',['build'],{cwd:project,shell})
  host=spawn(process.execPath,['dist/index.js'],{cwd:project,env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']})
  const url=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Generated app did not start: '+output)),30000)
    for(const stream of[host.stdout,host.stderr])stream.on('data',chunk=>{output+=chunk;const found=/"url":"(http:[^"]+)"/.exec(output);if(found){clearTimeout(timer);resolve(found[1])}})
    host.once('close',code=>{clearTimeout(timer);reject(new Error(`Generated app exited with ${code}: ${output}`))})
  })
  const health=await(await fetch(url+'/health',{signal:AbortSignal.timeout(5000)})).json()
  assert.deepEqual(health,{status:'ok',runtime:'node',ready:true})
  console.log('npm rehearsal: a project generated from the installed tarballs, outside this repository, builds, starts and reports healthy.')
}finally{
  if(host&&host.exitCode===null){const ended=new Promise(resolve=>host.once('close',resolve));host.kill('SIGTERM');await ended}
  await rm(temporary,{recursive:true,force:true})
}
