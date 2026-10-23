import { Longhorn } from '../../packages/core/dist/index.js'
import { Tracer } from '../../packages/observability/dist/index.js'
import { createQueueWorker } from '../../runtimes/workers/dist/queue.js'

const state={starts:0,stops:0,released:false,seen:[],spans:[],flushNext:false},app=new Longhorn()
let gate
const tracer=new Tracer({exporter:{async export(spans){if(state.flushNext){state.flushNext=false;await fetch(gate+'/flush')}state.spans.push(...spans);state.spans=state.spans.slice(-32)},async close(){}}})
app.onStart(()=>{state.starts++;return()=>{state.stops++;state.released=true}})
app.onStop(()=>tracer.close())
app.http.get('/health',c=>c.json({ok:true,name:c.env.NAME}))
const worker=createQueueWorker(app,{maxConcurrentBatches:2,messageConcurrency:2,timeoutMs:1000,
  handle:async({batch,message,bindings,signal})=>{
    gate=bindings.GATE_URL
    return tracer.trace('queue.fixture',async()=>{
      state.seen.push({id:message.id,time:message.timestamp.getTime(),attempts:message.attempts,name:bindings.NAME,queue:batch.queue});state.seen=state.seen.slice(-64)
      if(batch.queue==='dead')return{action:'ack'}
      const mode=message.body.mode
      if(mode==='failure')throw new Error('owned message failure')
      if(mode==='retry')return{action:'retry',delaySeconds:message.body.delay??3}
      if(mode==='poison'||(mode==='retry-once'&&message.attempts===1))return{action:'retry',delaySeconds:0}
      if(mode==='flush')state.flushNext=true
      if(mode?.startsWith('hold-')||mode==='cooperative'||mode==='ignore')await fetch(bindings.GATE_URL+'/'+mode,mode==='ignore'?{}:{signal})
      if(state.released)throw new Error('Resources released before queue work settled')
      return{action:'ack'}
    },{kind:'consumer',attributes:{'messaging.operation':'process'}})
  },afterBatch:async()=>{await tracer.flush()},
})
export default{...worker,async fetch(request,env,ctx){
  const path=new URL(request.url).pathname
  if(path==='/_fixture/state')return Response.json({...state,invocations:worker.stats()})
  if(path==='/_fixture/close'){await Promise.all([worker.close(),app.close()]);return Response.json({released:state.released,stops:state.stops})}
  if(path==='/_fixture/dispatch'){
    const input=await request.json(),messages=input.messages.map(message=>({...message,timestamp:new Date(message.timestamp??123000),attempts:message.attempts??1}))
    return Response.json(await env.SELF.queue(input.queue??'direct',messages))
  }
  if(path==='/_fixture/publish'){await env.SEND.send(await request.json(),{contentType:'json'});return new Response(null,{status:204})}
  return worker.fetch(request,env,ctx)
}}
