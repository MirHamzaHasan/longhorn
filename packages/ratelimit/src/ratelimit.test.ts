import { expect,it,vi } from 'vitest'
import { RateLimiter,RateLimitError } from './index.js'
import type { RateLimitStore } from './index.js'
import { MemoryRateLimitStore } from './memory.js'
it('atomically admits exactly the fixed window budget and does not extend it on rejection',async()=>{
  let now=100;const limiter=new RateLimiter({scope:'requests.v1',store:new MemoryRateLimitStore(),limit:3,windowMs:1000,now:()=>now})
  const results=await Promise.all(Array.from({length:30},()=>limiter.consume('private account')))
  expect(results.filter(row=>row.allowed)).toHaveLength(3);expect(results.filter(row=>row.allowed).map(row=>row.remaining).sort((a,b)=>b-a)).toEqual([2,1,0]);expect(results.every(row=>row.resetsAt===1100)).toBe(true)
  now=1099;expect(await limiter.consume('private account')).toMatchObject({allowed:false,retryAfterMs:1,resetsAt:1100});now=1100;expect(await limiter.consume('private account')).toMatchObject({allowed:true,remaining:2,resetsAt:2100});await limiter.close()
})
it('separates policy/subject buckets and exposes only scoped hashes to a custom store',async()=>{
  const rows:{scope:string;key:string}[]=[],store:RateLimitStore={async consume(input,now){rows.push({...input});return{allowed:true,remaining:0,resetsAt:now()+1000}},async prune(){return 0}}
  for(const scope of ['one','two']){const limiter=new RateLimiter({scope,store,limit:1});await limiter.consume('sensitive identity');await limiter.close()}
  expect(rows[0]?.key).toMatch(/^[a-f0-9]{64}$/);expect(rows[0]?.key).not.toBe(rows[1]?.key);expect(JSON.stringify(rows)).not.toContain('sensitive identity')
})
it('copies policy options and shares one budget across limiter instances using the same store',async()=>{
  const store=new MemoryRateLimitStore(),options={scope:'same',store,limit:1,windowMs:1000,now:()=>10},first=new RateLimiter(options);options.limit=500;options.scope='changed'
  const second=new RateLimiter({scope:'same',store,limit:1,windowMs:1000,now:()=>10});expect((await first.consume('a')).allowed).toBe(true);expect((await second.consume('a')).allowed).toBe(false);expect((await first.consume('b')).allowed).toBe(true);await Promise.all([first.close(),second.close()])
})
it('fails closed for changed live policy and permits new settings after expiry',async()=>{
  let time=0;const store=new MemoryRateLimitStore(),first=new RateLimiter({scope:'one',store,limit:1,windowMs:1000,now:()=>time}),next=new RateLimiter({scope:'one',store,limit:2,windowMs:2000,now:()=>time})
  await first.consume('a');await expect(next.consume('a')).rejects.toMatchObject({code:'POLICY_MISMATCH'});expect((await first.consume('a')).allowed).toBe(false);time=1000;expect(await next.consume('a')).toMatchObject({allowed:true,remaining:1,resetsAt:3000});await first.close();await next.close()
})
it('never evicts live windows at capacity and efficiently frees an expired bucket',async()=>{
  let time=0;const store=new MemoryRateLimitStore({maxEntries:2}),short=new RateLimiter({scope:'short',store,limit:1,windowMs:1000,now:()=>time}),long=new RateLimiter({scope:'long',store,limit:1,windowMs:2000,now:()=>time})
  await long.consume('live');await short.consume('expired');await expect(short.consume('new')).rejects.toMatchObject({code:'CAPACITY'});expect((await long.consume('live')).allowed).toBe(false);time=1000;expect((await short.consume('new')).allowed).toBe(true);expect((await long.consume('live')).allowed).toBe(false);await short.close();await long.close()
})
it('keeps the indexed expiry heap correct when arbitrary requested keys expire and pruning is bounded',async()=>{
  let now=0;const store=new MemoryRateLimitStore({maxEntries:100}),limiters=Array.from({length:20},(_,i)=>new RateLimiter({store,scope:'heap-'+i,limit:1,windowMs:1000+i*100,now:()=>now}))
  for(const limiter of limiters)await limiter.consume('a');now=2500
  // Expire an interior entry directly, then prune in small batches across all policies.
  expect((await limiters[10]!.consume('a')).allowed).toBe(true);expect(await limiters[0]!.prune(3)).toBe(3);expect(await limiters[0]!.prune(100)).toBe(12);expect(await limiters[0]!.prune(100)).toBe(0);now=10000;expect(await limiters[0]!.prune(100)).toBe(5);await Promise.all(limiters.map(row=>row.close()))
})
it('drains admitted work, including a synchronous close requested inside a store',async()=>{
  let release!:()=>void,closing!:Promise<void>,settled=false
  const store:RateLimitStore={async consume(input,now){const time=now();closing=limiter.close();void closing.then(()=>{settled=true});await new Promise<void>(done=>{release=done});return{allowed:true,remaining:0,resetsAt:time+input.windowMs}},async prune(){return 0}}
  const limiter=new RateLimiter({scope:'drain',store,limit:1});const work=limiter.consume('a');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(settled).toBe(false);await expect(limiter.consume('b')).rejects.toMatchObject({code:'CLOSED'});expect(limiter.close()).toBe(closing);release();await work;await closing;expect(settled).toBe(true);await expect(limiter.prune()).rejects.toMatchObject({code:'CLOSED'})
})
it('owns failed admitted calls until close while retaining errors on their original promises',async()=>{
  const error=new Error('provider failed'),store:RateLimitStore={async consume(){throw error},async prune(){throw error}},limiter=new RateLimiter({scope:'errors',store})
  await expect(limiter.consume('a')).rejects.toBe(error);await expect(limiter.prune()).rejects.toBe(error);await expect(limiter.close()).resolves.toBeUndefined()
})
it('validates UTF-8 subjects, policy, clocks and prune bounds without supplied-value error text',async()=>{
  for(const options of [{scope:''},{scope:'a',limit:0},{scope:'a',limit:1000001},{scope:'a',windowMs:999},{scope:'a',windowMs:86400001}])expect(()=>new RateLimiter({store:new MemoryRateLimitStore(),...options})).toThrow(RateLimitError)
  const limiter=new RateLimiter({scope:'input',store:new MemoryRateLimitStore()});for(const input of ['', '\ud800', '\udc00', 'é'.repeat(600)])await expect(limiter.consume(input)).rejects.toMatchObject({code:'INPUT'});expect((await limiter.consume('🐮')).allowed).toBe(true);await expect(limiter.prune(0)).rejects.toMatchObject({code:'INPUT'});await limiter.close()
  for(const now of [NaN,-1,Infinity,Number.MAX_SAFE_INTEGER]){const bad=new RateLimiter({scope:'clock',store:new MemoryRateLimitStore(),now:()=>now});await expect(bad.consume('a')).rejects.toMatchObject({code:'INPUT'});await bad.close()}
})
it('rejects malformed provider decisions and missing/multiple clock sampling',async()=>{
  for(const variant of ['missing-clock','two-clocks','count','expiry','allowed'] as const){const store:RateLimitStore={async consume(input,now){let time=0;if(variant!=='missing-clock')time=now();if(variant==='two-clocks')now();return{allowed:variant==='allowed'?undefined as unknown as boolean:true,remaining:variant==='count'?input.limit:0,resetsAt:variant==='expiry'?time:time+input.windowMs}},async prune(){return 101}};const limiter=new RateLimiter({scope:'protocol',store,limit:1});await expect(limiter.consume('a')).rejects.toMatchObject({code:'PROTOCOL'});await expect(limiter.prune()).rejects.toMatchObject({code:'PROTOCOL'});await limiter.close()}
})
