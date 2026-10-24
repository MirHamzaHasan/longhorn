import{context}from'esbuild'
import{spawn}from'node:child_process'
import{fileURLToPath}from'node:url'
import{buildOptions}from'./build.config.mjs'
let watcher,host,stopping=false,closing,sequence=Promise.resolve()
const report=(message)=>console.log(JSON.stringify({message}))
async function stopHost(){
  const owned=host;if(!owned)return
  owned.intentional=true;host=undefined
  if(owned.child.exitCode===null&&owned.child.signalCode===null)owned.child.kill('SIGTERM')
  let forced=false
  const timer=setTimeout(()=>{forced=true;owned.child.kill('SIGKILL')},10000)
  try{await owned.ended;if(forced)throw new Error('D1 development host did not stop')}
  finally{clearTimeout(timer)}
}
function shutdown(code=0){
  stopping=true;if(code)process.exitCode=code
  return closing??=(async()=>{
    try{await watcher?.dispose();await sequence;await stopHost();report('Development stopped')}
    catch{process.exitCode=1;report('Development cleanup failed')}
  })()
}
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown()})
function reload(){
  sequence=sequence.then(async()=>{
    if(stopping)return
    await stopHost();if(stopping)return
    const child=spawn(process.execPath,['serve.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),stdio:'inherit',env:process.env})
    const owned={child,intentional:false,ended:new Promise(resolve=>child.once('close',(code,signal)=>{
      resolve({code,signal})
      if(!owned.intentional&&!stopping){report('D1 development host exited');void shutdown(code||1)}
    }))}
    child.once('error',()=>{report('D1 development host could not start');void shutdown(1)})
    host=owned
  }).catch(()=>{report('D1 development reload failed');void shutdown(1)})
  return sequence
}
try{
  watcher=await context({...buildOptions,plugins:[{name:'d1-owned-reload',setup(builder){builder.onEnd(result=>{if(stopping)return;if(result.errors.length){report('D1 development build failed');return}return reload()})}}]})
  if(stopping){await watcher.dispose();await closing}
  else{await watcher.watch();report('D1 development watching')}
}catch{await shutdown(1)}
