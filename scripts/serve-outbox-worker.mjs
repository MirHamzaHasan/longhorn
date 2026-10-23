import { Miniflare,Log,LogLevel } from 'miniflare'
import { fileURLToPath } from 'node:url'
import { resolveServeOptions } from '../packages/runtime/dist/index.js'
const port=process.env.PORT??'3009'
if(!/^\d+$/.test(port))throw new Error('PORT must be a decimal integer')
const options=resolveServeOptions({hostname:process.env.HOST??'127.0.0.1',port:Number(port)})
const enabled=process.env.DISPATCH_ENABLED??'true'
if(!['true','false'].includes(enabled))throw new Error('DISPATCH_ENABLED must be true or false')
const signals=['SIGINT','SIGTERM'],previous=new Map(signals.map(signal=>[signal,new Set(process.listeners(signal))]))
const worker=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../examples/outbox-worker/dist/index.js',import.meta.url)),compatibilityDate:'2025-07-18',host:options.hostname,port:options.port,cf:false,log:new Log(LogLevel.WARN),
  bindings:{DISPATCH_ENABLED:enabled==='true',...(process.env.OUTBOX_OPERATIONS_TOKEN===undefined?{}:{OUTBOX_OPERATIONS_TOKEN:process.env.OUTBOX_OPERATIONS_TOKEN}),...(process.env.OUTBOX_OPERATIONS_ACTOR===undefined?{}:{OUTBOX_OPERATIONS_ACTOR:process.env.OUTBOX_OPERATIONS_ACTOR})},queueProducers:{MESSAGES:'longhorn-outgoing'},queueConsumers:{'longhorn-outgoing':{maxBatchSize:10,maxBatchTimeout:0,maxRetries:3}},
  durableObjects:{COMMANDS:{className:'CommandStore',useSQLite:true},RECEIPTS:{className:'ReceiptStore',useSQLite:true}},
  durableObjectsPersist:process.env.OUTBOX_DATA_PATH??fileURLToPath(new URL('../examples/outbox-worker/data/objects',import.meta.url)),
})
for(const signal of signals)for(const listener of process.listeners(signal))if(!previous.get(signal).has(listener))process.removeListener(signal,listener)
let closing
const close=()=>closing??=worker.dispose().then(()=>{console.log(JSON.stringify({message:'Application stopped'}))})
for(const signal of signals)process.on(signal,()=>{void close().catch(()=>{process.exitCode=1})})
try{
  const url=String(await worker.ready).replace(/\/$/,'')
  // Explicitly activate the known Object so a cold local host reconstructs its durable alarm.
  const activated=await worker.dispatchFetch('http://outbox.local/health');if(!activated.ok)throw new Error('Outbox host activation failed');await activated.text()
  console.log(JSON.stringify({message:'HTTP server listening',fields:{url}}))
}catch(error){await close();throw error}
