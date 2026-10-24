import { expect,it,vi } from 'vitest'
import { createRedisLimitsApp } from './app.js'
const apiToken='a'.repeat(64),defaults={apiToken,subject:'fixed-principal',namespace:'test',limit:2,windowMs:1000}
const post=(body:unknown,authorized=true)=>new Request('http://example/reports',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+apiToken}:{})},body:JSON.stringify(body)})
it('keeps authentication/body guards before Redis and validates input only after an admitted attempt',async()=>{
  const execute=vi.fn(async(command:readonly string[])=>command[0]==='PING'?'PONG':[1,1,1,2000,1000]),close=vi.fn(async()=>{}),app=createRedisLimitsApp({...defaults,openClient:async()=>({execute,close})})
  try{
    expect((await app.fetch(post({numbers:[1]},false))).status).toBe(401);expect(execute.mock.calls.filter(([c])=>c[0]==='EVAL')).toHaveLength(0)
    expect((await app.fetch(post({numbers:['x'.repeat(9000)]}))).status).toBe(413);expect(execute.mock.calls.filter(([c])=>c[0]==='EVAL')).toHaveLength(0)
    expect((await app.fetch(post({numbers:[1],subject:'spoof'}))).status).toBe(400);expect(execute.mock.calls.filter(([c])=>c[0]==='EVAL')).toHaveLength(1)
    const result=await app.fetch(post({numbers:[3,7]}));expect(result.status).toBe(200);expect(await result.json()).toEqual({result:{count:2,sum:10}})
  }finally{await app.close()};expect(close).toHaveBeenCalledOnce()
})
it('returns private 429 and provider 503 before invoking the calculation',async()=>{
  let unavailable=false
  const execute=vi.fn(async(command:readonly string[])=>{if(command[0]==='PING')return'PONG';if(unavailable)throw new Error('private native credentials');return[1,0,0,2000,1000]}),app=createRedisLimitsApp({...defaults,openClient:async()=>({execute,async close(){}})})
  try{const denied=await app.fetch(post({numbers:[1,2]}));expect(denied.status).toBe(429);expect(denied.headers.get('Retry-After')).toBe('1');expect(await denied.text()).not.toContain('sum');unavailable=true;const failed=await app.fetch(post({numbers:[1,2]}));expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('private')}finally{await app.close()}
})
it('releases acquired Redis on startup policy and health failures',async()=>{
  for(const failure of ['policy','health']){const close=vi.fn(async()=>{}),app=createRedisLimitsApp({...defaults,...(failure==='policy'?{limit:0}:{}),openClient:async()=>({async execute(){return'wrong'},close})});await expect(app.start()).rejects.toThrow();expect(close).toHaveBeenCalledOnce();await app.close()}
})
