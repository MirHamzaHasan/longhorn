import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { loadConsoleAssets } from '../examples/postgres/dist/console-assets.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { createQueuePublisher } from '../runtimes/workers/dist/outbox.js'
const rawPort=process.env.PORT??'3010'
if(!/^\d+$/.test(rawPort)||Number(rawPort)>65535)throw new Error('Invalid PORT')
const port=Number(rawPort),origin=process.env.AUTH_ORIGIN??'http://127.0.0.1:'+port
if(port===0&&!process.env.AUTH_ORIGIN)throw new Error('AUTH_ORIGIN is required for an ephemeral demo port')
let sandbox,owner,broker,app,lines,closing,requested=false,available=true,control=Promise.resolve()
const print=value=>console.log(JSON.stringify(value))
const shutdown=()=>{
 requested=true
 return closing??=(async()=>{
  await starting.catch(()=>{})
  lines?.close();await control.catch(()=>{})
  try{await app?.close()}finally{try{await broker?.dispose()}finally{try{await owner?.close()}finally{await sandbox?.stop()}}}
  print({message:'Application stopped'})
 })()
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown().catch(()=>{process.exitCode=1})})
print({message:'Starting account operations demo'})
const starting=(async()=>{
  sandbox=await startAccountOperationsSandbox()
  if(requested)return
  owner=await openPostgres({connectionString:sandbox.ownerUrl})
  if(requested)return
  const signals=['SIGINT','SIGTERM'],previous=new Map(signals.map(signal=>[signal,new Set(process.listeners(signal))]))
  broker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/index.js',import.meta.url)),compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),
    queueProducers:{MESSAGES:'account-commands'},queueConsumers:{'account-commands':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:3}},durableObjects:{COMMANDS:{className:'CommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}}})
  for(const signal of signals)for(const listener of process.listeners(signal))if(!previous.get(signal).has(listener))process.removeListener(signal,listener)
  await broker.ready
  if(requested)return
  const publisher=createQueuePublisher(await broker.getQueueProducer('MESSAGES'))
  app=createPostgresApp({console:await loadConsoleAssets(),openDatabase:()=>openPostgres({connectionString:sandbox.appUrl}),accounts:{origin,secure:false,sessionTtlMs:28800000,passwords:createScryptPasswordHasher()},
    operations:{publisher:{async publish(message,context){if(!available)throw new Error('Demo publisher is unavailable');await publisher.publish(message,context)}},
      readReceipt:id=>broker.dispatchFetch('http://receipts/receipts/'+id)}})
  const server=await app.listen(nodeRuntime,{hostname:'127.0.0.1',port})
  if(requested)return
  print({message:'Account operations demo listening',fields:{url:server.url,origin,controls:['grant USERNAME','revoke USERNAME','fail-publisher','restore-publisher']}})
  lines=createInterface({input:process.stdin})
  lines.on('line',line=>{if(requested)return;control=control.then(async()=>{
    const [command,username,...extra]=line.trim().split(/\s+/)
    if(command==='fail-publisher'&&!username){available=false;print({message:'Demo publisher unavailable'});return}
    if(command==='restore-publisher'&&!username){available=true;print({message:'Demo publisher restored'});return}
    if(['grant','revoke'].includes(command)&&username&&!extra.length){const result=await new PostgresAuthStore(owner).setUserRole(username,'numbers-operator',command==='grant');print({message:'Operator role result',result});return}
    print({message:'Unknown control command'})
  }).catch(()=>{print({message:'Operator control failed'})})})
})()
try{await starting}catch{console.error('Account operations demo failed; verify native support, origin and build output');process.exitCode=1;await shutdown()}
