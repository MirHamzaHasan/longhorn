import { Miniflare,Log,LogLevel } from 'miniflare'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createBearerVerifier } from '../packages/auth/dist/bearer.js'
import { resolveServeOptions } from '../packages/runtime/dist/index.js'

let worker,requested=false,closing
const print=value=>console.log(JSON.stringify(value))
const shutdown=()=>{
  requested=true
  return closing??=(async()=>{await starting.catch(()=>{});await worker?.dispose();print({message:'Application stopped'})})()
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown().catch(()=>{process.exitCode=1})})
const starting=(async()=>{
  const token=process.env.RECEIVER_TOKEN
  createBearerVerifier(token)
  const rawPort=process.env.PORT??'3012'
  if(!/^\d+$/.test(rawPort))throw new Error('Invalid receiver port')
  const options=resolveServeOptions({hostname:process.env.HOST??'127.0.0.1',port:Number(rawPort)})
  const directory=process.env.RECEIVER_DATA_PATH??fileURLToPath(new URL('../examples/outbox-worker/data/receiver',import.meta.url))
  if(!directory.trim())throw new Error('Invalid receiver storage path')
  const signals=['SIGINT','SIGTERM'],previous=new Map(signals.map(signal=>[signal,new Set(process.listeners(signal))]))
  worker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/receiver.js',import.meta.url)),compatibilityDate:'2025-07-18',cf:false,host:options.hostname,port:options.port,log:new Log(LogLevel.NONE),
    bindings:{RECEIVER_TOKEN:token},durableObjects:{RECEIPTS:{className:'ReceiptStore',useSQLite:true}},durableObjectsPersist:resolve(directory)})
  for(const signal of signals)for(const listener of process.listeners(signal))if(!previous.get(signal).has(listener))process.removeListener(signal,listener)
  const url=String(await worker.ready).replace(/\/$/,'')
  if(requested)return
  const ready=await worker.dispatchFetch('http://receiver/health',{headers:{Authorization:'Bearer '+token}})
  await ready.text();if(!ready.ok)throw new Error('Receiver storage did not become ready')
  if(!requested)print({message:'HTTP server listening',fields:{url}})
})()
try{await starting}catch{console.error('Message receiver startup failed; verify credential, port, storage and build output');process.exitCode=1;await shutdown()}
