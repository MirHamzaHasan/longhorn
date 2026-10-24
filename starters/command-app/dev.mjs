import { build } from 'esbuild'
import { watch,watchFile,unwatchFile } from 'node:fs'
import { mkdir,writeFile } from 'node:fs/promises'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appBuild,consoleBuild,receiverBuild } from './build.config.mjs'
import { startHost,stopHost } from './dev-host.mjs'

const args=process.argv.slice(2)
if(args.length && (args.length!==1 || args[0]!=='--receiver'))throw new Error('Usage: node dev.mjs [--receiver]')
const role=args.length?'receiver':'app',directory=fileURLToPath(new URL('.',import.meta.url))
const builds=role==='app'?[appBuild,consoleBuild]:[receiverBuild],watchers=[],profiles=[]
const controller=new AbortController()
let owned,stopping=false,closing,sequence=Promise.resolve(),working=false,timer,revision=0,queued=0,handled=0,generation=0
const report=(message,fields={})=>console.log(JSON.stringify({message,fields:{role,...fields}}))
function shutdown(code=0){
  stopping=true;controller.abort();clearTimeout(timer)
  if(code)process.exitCode=code
  return closing??=(async()=>{
    const failures=[]
    for(const watcher of watchers)try{watcher.close()}catch{failures.push('watcher')}
    for(const [file,listener]of profiles)unwatchFile(file,listener)
    try{await sequence}catch{failures.push('build')}
    try{await stopHost(owned)}catch{failures.push('native host')}
    if(failures.length){process.exitCode=1;report('Command development cleanup failed',{stages:failures})}
    else report('Command development stopped')
  })()
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown()})
function schedule(){
  if(stopping)return
  revision++;clearTimeout(timer)
  timer=setTimeout(()=>{timer=undefined;queued=revision;drive()},100)
}
function drive(){
  if(working||stopping)return
  working=true
  sequence=(async()=>{
    while(queued>handled&&!stopping){
      const selected=queued
      // Both app and browser builds settle before deciding whether this generation is usable.
      const results=await Promise.allSettled(builds.map(options=>build({...options,write:false})))
      handled=selected
      if(stopping||selected!==revision)continue
      if(results.some(result=>result.status==='rejected')){report('Command development build failed');continue}
      if(owned)report('Command development host stopping',{generation})
      await stopHost(owned);owned=undefined
      if(stopping||selected!==revision)continue
      for(const result of results)for(const file of result.value.outputFiles){
        await mkdir(dirname(file.path),{recursive:true});await writeFile(file.path,file.contents)
      }
      if(stopping||selected!==revision)continue
      const current=startHost(role,controller.signal);owned=current;generation++
      void current.ended.then(result=>{
        if(!current.intentional&&!stopping){
          report('Command development host exited')
          void shutdown(Number.isInteger(result.code)&&result.code>0&&result.code<=255?result.code:1)
        }
      })
      report('Command development host started',{generation})
    }
  })().catch(()=>{if(!stopping){report('Command development reload failed');void shutdown(1)}}).finally(()=>{working=false})
}
try{
  for(const root of role==='app'?['src','console']:['receiver']){
    const watcher=watch(join(directory,root),{recursive:true},schedule)
    watcher.on('error',()=>{report('Command development watcher failed');void shutdown(1)});watchers.push(watcher)
  }
  if(role==='app')for(const name of ['.operator.env','.operator.env.local']){
    const file=join(directory,name),listener=(now,before)=>{if(now.mtimeMs!==before.mtimeMs||now.size!==before.size||now.ino!==before.ino)schedule()}
    watchFile(file,{interval:200,persistent:false},listener);profiles.push([file,listener])
  }
  report('Command development watching');schedule()
}catch{await shutdown(1)}
