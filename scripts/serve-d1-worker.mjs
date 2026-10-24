import{Miniflare,Log,LogLevel}from'miniflare'
import{fileURLToPath}from'node:url'
import{resolveServeOptions}from'../packages/runtime/dist/index.js'
import{loadConfig}from'../packages/config/dist/index.js'
import{configSchema}from'../examples/d1-worker/dist/config.js'
const port=process.env.PORT??'3016';if(!/^\d+$/.test(port))throw new Error('Invalid D1 host port')
const options=resolveServeOptions({hostname:process.env.HOST??'127.0.0.1',port:Number(port)}),signals=['SIGINT','SIGTERM']
const config=await loadConfig(configSchema,{D1_MAX_PENDING:process.env.D1_MAX_PENDING,D1_REQUEST_RETENTION_MS:process.env.D1_REQUEST_RETENTION_MS})
const previous=new Map(signals.map(signal=>[signal,new Set(process.listeners(signal))]))
const database={DB:'longhorn-d1-tasks'},directory=process.env.D1_DATA_PATH??fileURLToPath(new URL('../examples/d1-worker/data/d1',import.meta.url))
const application={name:'tasks',modules:true,compatibilityDate:'2025-07-18',scriptPath:fileURLToPath(new URL('../examples/d1-worker/dist/index.js',import.meta.url)),d1Databases:database,bindings:{D1_MAX_PENDING:String(config.maxPending),D1_REQUEST_RETENTION_MS:String(config.retentionMs)}}
const nativeOptions={host:options.hostname,port:options.port,cf:false,compatibilityDate:'2025-07-18',d1Persist:directory,log:new Log(LogLevel.WARN),workers:[
  application,
  {name:'schema',modules:true,compatibilityDate:'2025-07-18',scriptPath:fileURLToPath(new URL('../examples/d1-worker/dist/deploy.js',import.meta.url)),d1Databases:database},
]}
const worker=new Miniflare(nativeOptions)
for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
let requested=false,closing
const shutdown=()=>{requested=true;return closing??=worker.dispose().then(()=>console.log(JSON.stringify({message:'Application stopped'})))}
for(const signal of signals)process.on(signal,()=>{void shutdown().catch(()=>{process.exitCode=1})})
console.log(JSON.stringify({message:'D1 development host starting'}))
try{
  await worker.ready
  if(!requested){
    const schema=await worker.getWorker('schema'),response=await schema.fetch('http://private/deploy',{method:'POST'})
    if(!response.ok)throw new Error('D1 deployment failed; verify retained schema and migration history')
    const deployment=await response.json()
    if(!requested){
      // Remove deployment authority from the running development host before announcing HTTP.
      await worker.setOptions({...nativeOptions,workers:[application]})
      const url=String(await worker.ready).replace(/\/$/,'')
      if((await worker.dispatchFetch('http://local/health')).status!==200)throw new Error('D1 application readiness failed after deployment')
      if(!requested){console.log(JSON.stringify({message:'D1 schema ready',fields:deployment}));console.log(JSON.stringify({message:'HTTP server listening',fields:{url}}))}
    }
  }
}catch(error){const cancelled=requested;await shutdown();if(!cancelled)throw error}
