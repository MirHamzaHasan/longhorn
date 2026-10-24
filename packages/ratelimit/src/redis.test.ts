import { expect,it,vi } from 'vitest'
import { RateLimiter,RateLimitError } from './index.js'
import type { RateLimitReservation,ServerTimedRateLimitStore } from './index.js'
import { RedisRateLimitStore } from './redis.js'
const request:RateLimitReservation={scope:'api:reports/v1',key:'a'.repeat(64),limit:2,windowMs:1000}
function fixture(replies:unknown[]){const calls:string[][]=[],close=vi.fn();const client={async execute(command:readonly string[]){calls.push([...command]);return replies.shift()},close};return{store:new RedisRateLimitStore(client,{namespace:'one'}),client,calls,close}}
it('uses the declared server clock for remaining wait without consulting application time',async()=>{
  const state=fixture([[1,0,0,1500,1000]]),now=vi.spyOn(Date,'now').mockReturnValue(9999999999999)
  try{const limiter=new RateLimiter({scope:request.scope,limit:2,windowMs:1000,store:state.store});expect(await limiter.consume('private identity')).toEqual({allowed:false,remaining:0,resetsAt:1500,retryAfterMs:500});expect(await limiter.prune(5)).toBe(0);await limiter.close();expect(now).not.toHaveBeenCalled();expect(state.close).not.toHaveBeenCalled();expect(state.calls).toHaveLength(1)}finally{now.mockRestore()}
})
it('keeps explicit client-clock overrides invalid on server-timed providers',()=>{
  const {store}=fixture([]);expect(()=>new RateLimiter({scope:'server',store,now:()=>0})).toThrow(RateLimitError)
  for(const clock of ['unexpected',null,1])expect(()=>new RateLimiter({scope:'invalid',store:{...store,clock,consume:store.consume.bind(store),prune:store.prune.bind(store)} as unknown as ServerTimedRateLimitStore})).toThrow(RateLimitError)
})
it('uses one literal, hashed namespace key with policy-only arguments and snapshots options',async()=>{
  const calls:string[][]=[],client={async execute(command:readonly string[]){calls.push([...command]);return[1,1,1,2000,1000]}},options={namespace:'copied',maxConcurrent:1},store=new RedisRateLimitStore(client,options);options.namespace='changed'
  const limiter=new RateLimiter({store,scope:request.scope,limit:2,windowMs:1000});await limiter.consume('雪:*private')
  expect(calls[0]?.[0]).toBe('EVAL');expect(calls[0]?.slice(2,3)).toEqual(['1']);expect(calls[0]?.[3]).toMatch(/^longhorn:ratelimit:v1:copied:[A-Za-z0-9_-]+:[a-f0-9]{64}$/);expect(calls[0]?.slice(4)).toEqual(['2','1000']);expect(JSON.stringify(calls)).not.toContain('雪:*private');await limiter.close()
})
it('rejects malformed native replies and translates an explicit policy mismatch',async()=>{
  const {store}=fixture([[2]]);await expect(store.consume(request)).rejects.toMatchObject({code:'POLICY_MISMATCH'})
  for(const reply of [null,{},'private response',[3],[2,'extra'],[1,2,0,2000,1000],[1,1,2,2000,1000],[1,0,1,2000,1000],[1,1,1,1000,1000],[1,1,1,2000,-1],[1,1,1,2000,NaN],[1,1,1,Number.MAX_SAFE_INTEGER+1,1000]]){
    const state=fixture([reply]);await expect(state.store.consume(request)).rejects.toMatchObject({code:'PROTOCOL'})
  }
})
it('checks server-reported time in the coordinator for custom providers',async()=>{
  for(const observedAt of [undefined,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER]){
    const store:ServerTimedRateLimitStore={clock:'server',async consume(){return{allowed:true,remaining:0,resetsAt:2000,observedAt:observedAt as number}},async prune(){return 0}},limiter=new RateLimiter({scope:'protocol',store,limit:1,windowMs:1000})
    await expect(limiter.consume('subject')).rejects.toMatchObject({code:'PROTOCOL'});await limiter.close()
  }
})
it('bounds active Redis operations and drains accepted work before the borrowed connection is released',async()=>{
  let release!:(value:unknown)=>void,entered=false,finished=false
  const client={execute:vi.fn(()=>{entered=true;return new Promise<unknown>(done=>{release=done})}),close:vi.fn(async()=>{})},store=new RedisRateLimitStore(client,{namespace:'owned',maxConcurrent:1}),limiter=new RateLimiter({scope:'drain',store,limit:2,windowMs:1000})
  const first=limiter.consume('one');await vi.waitFor(()=>expect(entered).toBe(true));await expect(limiter.consume('two')).rejects.toMatchObject({code:'CAPACITY'})
  const closing=limiter.close().then(()=>{finished=true});await Promise.resolve();expect(finished).toBe(false);expect(client.close).not.toHaveBeenCalled();release([1,1,1,2000,1000]);await first;await closing;await client.close();expect(client.execute).toHaveBeenCalledOnce();expect(client.close).toHaveBeenCalledOnce()
})
it('retains original command failures, releases capacity and never retries a reservation',async()=>{
  const failure=new Error('private native error'),client={execute:vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce([1,1,1,2000,1000])},store=new RedisRateLimitStore(client,{namespace:'errors',maxConcurrent:1})
  await expect(store.consume(request)).rejects.toBe(failure);expect((await store.consume(request)).allowed).toBe(true);expect(client.execute).toHaveBeenCalledTimes(2)
})
it('validates namespace/admission/prune inputs before any native command',async()=>{
  const state=fixture([])
  for(const namespace of ['', '*','one:two','a'.repeat(65)])expect(()=>new RedisRateLimitStore(state.client,{namespace})).toThrow(RateLimitError)
  for(const maxConcurrent of [0,1025,1.5,NaN])expect(()=>new RedisRateLimitStore(state.client,{namespace:'limits',maxConcurrent})).toThrow(RateLimitError)
  await expect(state.store.consume({...request,key:'raw subject'})).rejects.toMatchObject({code:'INPUT'});await expect(state.store.prune({limit:0})).rejects.toMatchObject({code:'INPUT'});expect(state.calls).toHaveLength(0)
})
