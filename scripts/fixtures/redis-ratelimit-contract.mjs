import { RateLimiter } from '../../packages/ratelimit/dist/index.js'
import { RedisRateLimitStore } from '../../packages/ratelimit/dist/redis.js'
import { rateLimit } from '../../packages/ratelimit/dist/hono.js'
import { createHttpApp } from '../../packages/http/dist/index.js'
const check=(value,message)=>{if(!value)throw new Error(message)}
/** Portable command boundary only. Actual Lua/TCP behavior is a separate native gate. */
export async function verifyRedisRateLimitProtocol(){
  const commands=[],replies=[[1,1,0,2500,1000],[1,0,0,2500,1500]],store=new RedisRateLimitStore({async execute(command){commands.push([...command]);return replies.shift()}},{namespace:'portable'})
  const limiter=new RateLimiter({scope:'reports.v1',store,limit:1,windowMs:1500}),app=createHttpApp();let effects=0
  app.post('/',rateLimit(limiter,()=> 'private 🐮 principal'),c=>{effects++;return c.json({accepted:true})})
  check((await app.request('/',{method:'POST'})).status===200,'Allowed attempt failed')
  const blocked=await app.request('/',{method:'POST'});check(blocked.status===429&&blocked.headers.get('retry-after')==='1','Wrong server-clock wait');check(effects===1,'Denied handler ran')
  check(commands.length===2&&commands.every(command=>command[0]==='EVAL'&&command[2]==='1'&&/^longhorn:ratelimit:v1:portable:[A-Za-z0-9_-]+:[a-f0-9]{64}$/.test(command[3])),'Invalid command identity')
  check(!JSON.stringify(commands).includes('private 🐮 principal'),'Raw subject reached the provider');check(await limiter.prune()===0,'Native TTL prune changed');await limiter.close()
  let release,closing,done=false,entered=false
  const owned=new RateLimiter({scope:'drain',limit:1,store:new RedisRateLimitStore({async execute(){entered=true;closing=owned.close();void closing.then(()=>{done=true});await new Promise(resolve=>{release=resolve});return[1,1,0,2000,1000]}},{namespace:'drain'})})
  const work=owned.consume('a');while(!entered)await new Promise(resolve=>setTimeout(resolve,0));check(!done,'Close abandoned accepted work');release();await work;await closing;check(done,'Close did not settle')
  return{serverClock:true,hono:true,privacy:true,nativeTtlPrune:true,reentrantDrain:true}
}
