import { createHttpApp } from '../../packages/http/dist/index.js'
import { RateLimiter,RateLimitError } from '../../packages/ratelimit/dist/index.js'
import { MemoryRateLimitStore } from '../../packages/ratelimit/dist/memory.js'
import { rateLimit } from '../../packages/ratelimit/dist/hono.js'
const assert=(value,message)=>{if(!value)throw new Error(message)}
export async function rateLimitContract(){
  let time=10,effects=0
  const store=new MemoryRateLimitStore({maxEntries:3}),limiter=new RateLimiter({store,scope:'portable.v1',limit:2,windowMs:1000,now:()=>time})
  const batch=await Promise.all(Array.from({length:20},()=>limiter.consume('private subject')))
  assert(batch.filter(row=>row.allowed).length===2,'Budget exceeded');assert(batch.every(row=>row.resetsAt===1010),'Rejection extended the window')
  const app=createHttpApp();app.get('/',rateLimit(limiter,()=> 'private subject'),c=>{effects++;return c.json({ok:true})})
  let response=await app.request('/');assert(response.status===429&&response.headers.get('retry-after')==='1','Wrong quota response');assert(!(await response.text()).includes('private'),'Subject exposed')
  time=1010;assert((await app.request('/')).status===200&&effects===1,'Expiry did not replenish')
  const mismatch=new RateLimiter({store,scope:'portable.v1',limit:3,windowMs:1000,now:()=>time})
  try{await mismatch.consume('private subject');throw new Error('Changed policy admitted')}catch(error){assert(error instanceof RateLimitError&&error.code==='POLICY_MISMATCH','Wrong policy error')}
  await limiter.consume('second');await limiter.consume('third');try{await limiter.consume('fourth');throw new Error('Live capacity evicted')}catch(error){assert(error.code==='CAPACITY','Wrong capacity error')}
  time=3000;assert(await limiter.prune(2)===2&&await limiter.prune(2)===1,'Wrong bounded prune')
  let closing,release,settled=false
  const held=new RateLimiter({scope:'held',limit:1,store:{async consume(input,now){const time=now();closing=held.close();void closing.then(()=>{settled=true});await new Promise(done=>{release=done});return{allowed:true,remaining:0,resetsAt:time+input.windowMs}},async prune(){return 0}}})
  const work=held.consume('a');while(!release)await new Promise(done=>setTimeout(done,1));assert(!settled,'Closed before admitted work');release();await work;await closing;assert(settled,'Close did not drain')
  try{await held.consume('b');throw new Error('Closed limiter admitted')}catch(error){assert(error.code==='CLOSED','Wrong closed error')}
  await limiter.close();await mismatch.close()
  return{quota:true,expiry:true,scopePrivacy:true,policyMismatch:true,capacity:true,boundedPrune:true,hono:true,reentrantDrain:true}
}
